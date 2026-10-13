"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { gameAction, GameActionError, useGameSession } from "@/lib/game-sdk/client";
import type { SubterfugeView } from "../schema";

interface SubterfugeBoardProps {
  // Passed to every PlayComponent by core:
  shareCode: string;
  currentUserId: string; // "" for someone watching a public game
  hostId: string;
  players: Array<{ playerId: string; username: string }>;
  // From buildPlayProps:
  title: string;
  initialView: SubterfugeView;
}

type Method = "GET" | "POST";

export function SubterfugeBoard({ shareCode, currentUserId, hostId, players, title, initialView }: SubterfugeBoardProps) {
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  // Replies can arrive out of order; only the latest request may set the view.
  const latest = useRef(0);

  const request = useCallback(
    async (action: string, input?: unknown, method: Method = "POST") => {
      const mine = ++latest.current;
      const next = await gameAction<SubterfugeView & { finished?: boolean }>("subterfuge", shareCode, action, input, method);
      if (mine === latest.current) setView(next);
      return next;
    },
    [shareCode]
  );

  const refresh = useCallback(() => {
    request("state", undefined, "GET").catch(() => {});
  }, [request]);

  // The broadcast only says that something changed; what this viewer may see
  // of it comes from the server. The hook also takes everyone to the reveal.
  useGameSession(shareCode, {
    onEvent: (name) => {
      if (name === "changed") refresh();
    },
  });

  // A phone that was asleep missed the broadcasts.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const act = async (action: "lie" | "pick" | "next" | "skip", input: unknown) => {
    setBusy(true);
    try {
      const next = await request(action, input);
      if (next.finished) router.push(`/sessions/${shareCode}/reveal`);
      return true;
    } catch (e) {
      toast.error(e instanceof GameActionError ? e.message : "Something went wrong");
      // 409: someone else's action landed first.
      if (e instanceof GameActionError && e.status === 409) refresh();
      return false;
    } finally {
      setBusy(false);
    }
  };

  const isPlayer = players.some((p) => p.playerId === currentUserId);
  const isHost = currentUserId === hostId;
  const step = { round: view.round, phase: view.phase };
  const name = (id: string) => players.find((p) => p.playerId === id)?.username ?? "Someone";
  const waitingOn = players.filter((p) => !view.actedIds.includes(p.playerId));
  const [before, after] = view.prompt.split("_____");

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>
            Question {view.round + 1} of {view.totalRounds}
          </span>
          {view.multiplier > 1 && <Badge variant="outline">Double points</Badge>}
        </div>
      </div>

      <div className="border rounded-lg p-5 bg-card text-center text-lg font-medium leading-relaxed">
        {before}
        {after !== undefined && (
          <span className="inline-block min-w-16 border-b-2 border-primary px-1 text-primary">
            {view.results ? view.results.answer : " "}
          </span>
        )}
        {after}
        {after === undefined && view.results && <span className="block mt-2 text-primary">{view.results.answer}</span>}
      </div>

      {view.phase === "lying" &&
        (isPlayer && !view.myLie ? (
          <LieForm key={view.round} busy={busy} onSubmit={(text) => act("lie", { text })} />
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            {view.myLie ? (
              <>
                Your lie: <span className="font-semibold text-foreground">{view.myLie}</span>
              </>
            ) : (
              "Everyone is writing a lie…"
            )}
          </p>
        ))}

      {view.phase === "guessing" && view.choices && (
        <div className="space-y-2">
          <p className="text-center text-sm text-muted-foreground">
            {!isPlayer ? "Everyone is picking…" : view.myPick ? "Locked in." : "Which one is the truth?"}
          </p>
          {view.choices.map((choice) => (
            <Button
              key={choice.id}
              variant={view.myPick === choice.id ? "default" : "outline"}
              className="w-full h-auto min-h-10 whitespace-normal py-2"
              disabled={!isPlayer || busy || !!view.myPick || choice.mine}
              onClick={() => act("pick", { choiceId: choice.id })}
            >
              {choice.text}
              {choice.mine && <span className="ml-2 text-xs font-normal opacity-70">(your lie)</span>}
            </Button>
          ))}
        </div>
      )}

      {view.phase === "results" && view.results && (
        <div className="space-y-2">
          {view.results.choices.map((choice) => (
            <div
              key={choice.id}
              className={`border rounded-lg p-3 space-y-1 ${
                choice.isTruth ? "bg-primary/15 border-primary/60" : "bg-muted/30"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-sm">{choice.text}</span>
                <Badge variant={choice.isTruth ? "default" : "secondary"} className="text-xs shrink-0">
                  {choice.isTruth
                    ? "The truth"
                    : choice.authorIds.length > 0
                      ? `${choice.authorIds.map(name).join(" & ")}'s lie`
                      : "Decoy"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {choice.pickerIds.length === 0
                  ? "Nobody picked this"
                  : `${choice.isTruth ? "Found by" : "Fooled"} ${choice.pickerIds.map(name).join(", ")}`}
              </p>
            </div>
          ))}
          {isPlayer && (
            <Button className="w-full" disabled={busy} onClick={() => act("next", step)}>
              {view.round + 1 >= view.totalRounds ? "See final scores" : "Next question"}
            </Button>
          )}
        </div>
      )}

      <div className="border rounded-lg p-3 space-y-2">
        {players.map((p) => {
          const gained = view.results?.gained[p.playerId];
          return (
            <div key={p.playerId} className="flex items-center gap-3">
              <span className="text-sm font-medium flex-1">
                {p.username}
                {p.playerId === currentUserId && <span className="text-xs text-muted-foreground"> (you)</span>}
              </span>
              {view.actedIds.includes(p.playerId) && <Check className="h-4 w-4 text-primary" />}
              {gained ? <span className="text-xs text-primary font-semibold">+{gained}</span> : null}
              <span className="font-mono text-sm font-semibold">{view.scores[p.playerId] ?? 0}</span>
            </div>
          );
        })}
      </div>

      {view.phase !== "results" && waitingOn.length > 0 && (
        <div className="text-center space-y-2">
          <p className="text-xs text-muted-foreground">Waiting for {waitingOn.map((p) => p.username).join(", ")}</p>
          {isHost && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => act("skip", step)}>
              Stop waiting and move on
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function LieForm({ busy, onSubmit }: { busy: boolean; onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const ready = text.trim().length > 0 && !busy;
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(text);
      }}
    >
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={60}
        placeholder="Write a convincing lie"
        autoFocus
      />
      <Button type="submit" disabled={!ready}>
        Submit
      </Button>
    </form>
  );
}
