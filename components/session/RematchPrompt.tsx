"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useSession } from "@/hooks/useSession";
import { Check, Loader2, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export interface RematchPlayer {
  playerId: string;
  username: string;
}

interface RematchPromptProps {
  shareCode: string;
  /** Where this game's content is chosen, e.g. "/games/pool_dooks". */
  browsePath: string;
  currentUserId: string;
  players: RematchPlayer[];
  /** Server-rendered state, so a refresh or a late arrival still sees the prompt. */
  initialProposedBy: string | null;
  initialAccepted: string[];
  initialDeclined: string[];
  initialNewSessionCode: string | null;
}

export function RematchPrompt({
  shareCode,
  browsePath,
  currentUserId,
  players,
  initialProposedBy,
  initialAccepted,
  initialDeclined,
  initialNewSessionCode,
}: RematchPromptProps) {
  const router = useRouter();
  const [proposedBy, setProposedBy] = useState<string | null>(initialProposedBy);
  const [accepted, setAccepted] = useState<string[]>(initialAccepted);
  const [declined, setDeclined] = useState<string[]>(initialDeclined);
  const [newSessionCode, setNewSessionCode] = useState<string | null>(initialNewSessionCode);
  const [proposing, setProposing] = useState(false);
  const [responding, setResponding] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const nameOf = (id: string) =>
    players.find((p) => p.playerId === id)?.username ?? "A player";

  const isProposer = proposedBy === currentUserId;
  const hasAnswered = accepted.includes(currentUserId) || declined.includes(currentUserId);

  useSession(shareCode, (event) => {
    switch (event.type) {
      case "rematch:proposed":
        setProposedBy(event.payload.proposedBy);
        setAccepted([event.payload.proposedBy]);
        setDeclined([]);
        setDismissed(false);
        break;

      case "rematch:responded": {
        const { playerId, accepted: yes } = event.payload;
        setAccepted((prev) =>
          yes ? [...prev.filter((id) => id !== playerId), playerId] : prev.filter((id) => id !== playerId)
        );
        setDeclined((prev) =>
          yes ? prev.filter((id) => id !== playerId) : [...prev.filter((id) => id !== playerId), playerId]
        );
        break;
      }

      case "rematch:ready":
        setNewSessionCode(event.payload.shareCode);
        // Only players who said yes get pulled into the next lobby.
        if (accepted.includes(currentUserId)) {
          router.push(`/sessions/${event.payload.shareCode}`);
        }
        break;
    }
  });

  const propose = async () => {
    setProposing(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/rematch`, { method: "POST" });
      if (!res.ok) throw new Error();
      const { rematch } = await res.json();
      setProposedBy(rematch.proposedBy);
      setAccepted(rematch.accepted);
      setDeclined(rematch.declined);
      setDismissed(false);
    } catch {
      toast.error("Couldn't start a rematch");
    } finally {
      setProposing(false);
    }
  };

  const respond = async (yes: boolean) => {
    setResponding(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/rematch/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accepted: yes }),
      });
      if (!res.ok) throw new Error();
      const { rematch } = await res.json();
      setAccepted(rematch.accepted);
      setDeclined(rematch.declined);
      if (!yes) setDismissed(true);
    } catch {
      toast.error("Couldn't send your answer");
    } finally {
      setResponding(false);
    }
  };

  // The next round already exists — anyone arriving late can still walk in.
  if (newSessionCode) {
    return (
      <Link
        href={`/sessions/${newSessionCode}`}
        className={cn(buttonVariants({ variant: "default" }), "gap-2")}
      >
        <RotateCcw className="h-4 w-4" />
        Join next round
      </Link>
    );
  }

  const promptOpen = proposedBy !== null && !dismissed;

  return (
    <>
      <Button variant="outline" className="gap-2" onClick={propose} disabled={proposing || proposedBy !== null}>
        {proposing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
        Play Again
      </Button>

      <Dialog open={promptOpen} onOpenChange={(open) => !open && setDismissed(true)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Play again with this group?</DialogTitle>
            <DialogDescription>
              {isProposer
                ? "Waiting on the others. You can pick the next game whenever you're ready — anyone who hasn't answered gets left behind."
                : `${nameOf(proposedBy ?? "")} wants another round. Stay in this lobby?`}
            </DialogDescription>
          </DialogHeader>

          <ul className="space-y-1.5">
            {players.map((p) => {
              const yes = accepted.includes(p.playerId);
              const no = declined.includes(p.playerId);
              return (
                <li key={p.playerId} className="flex items-center gap-2 text-sm">
                  {yes ? (
                    <Check className="h-4 w-4 text-primary" />
                  ) : no ? (
                    <X className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  )}
                  <span className={cn("flex-1", no && "text-muted-foreground line-through")}>
                    {p.username}
                    {p.playerId === currentUserId && " (you)"}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {yes ? "in" : no ? "out" : "deciding"}
                  </span>
                </li>
              );
            })}
          </ul>

          <DialogFooter>
            {isProposer ? (
              <Button
                onClick={() => router.push(browsePath)}
                className="gap-2"
              >
                Pick the next game ({accepted.length} in)
              </Button>
            ) : hasAnswered ? (
              <p className="text-sm text-muted-foreground">
                {accepted.includes(currentUserId)
                  ? `You're in — waiting for ${nameOf(proposedBy ?? "")} to pick the next game.`
                  : "You've left this group."}
              </p>
            ) : (
              <>
                <Button variant="ghost" disabled={responding} onClick={() => respond(false)}>
                  No thanks
                </Button>
                <Button disabled={responding} onClick={() => respond(true)} className="gap-2">
                  {responding && <Loader2 className="h-4 w-4 animate-spin" />}
                  Stay in
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
