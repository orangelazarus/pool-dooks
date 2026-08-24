"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useGameState } from "@/hooks/useGameState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Crown } from "lucide-react";

interface NumberGameBoardProps {
  shareCode: string;
  currentUserId: string;
  hostId: string;
  players: Array<{ playerId: string; username: string; avatarUrl?: string | null }>;
  title: string;
  min: number;
  max: number;
  tokenOrder: string[];
  initialCurrentTokenId: string;
  initialCurrentPlayerId: string;
  initialTokenIndex: number;
}

export function NumberGameBoard({
  shareCode,
  currentUserId,
  players,
  title,
  min,
  max,
  tokenOrder,
  initialCurrentTokenId,
  initialCurrentPlayerId,
  initialTokenIndex,
}: NumberGameBoardProps) {
  const router = useRouter();
  const [guess, setGuess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const { state, handleEvent } = useGameState(players, {
    tokenOrder,
    currentTokenId: initialCurrentTokenId,
    currentPlayerId: initialCurrentPlayerId,
    tokenIndex: initialTokenIndex,
  });

  useSession(shareCode, (event) => {
    handleEvent(event);
    if (event.type === "session:completed" || event.type === "session:revealed") {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });

  const isMyTurn = state.currentPlayerId === currentUserId;
  const myTokenId = `guess_${currentUserId}`;
  const hasGuessed = state.answeredTokenIds.has(myTokenId);
  const guessedCount = state.answeredTokenIds.size;
  const totalPlayers = tokenOrder.length;
  const currentPlayer = players.find((p) => p.playerId === state.currentPlayerId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const num = parseInt(guess, 10);
    if (isNaN(num) || num < min || num > max) {
      toast.error(`Enter a number between ${min} and ${max}`);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: state.currentTokenId, value: String(num) }),
      });
      let data: { ok?: boolean; isComplete?: boolean } = {};
      try { data = await res.json(); } catch {}
      if (!res.ok) throw new Error();
      if (data.isComplete) router.push(`/sessions/${shareCode}/reveal`);
      else setGuess("");
    } catch {
      toast.error("Failed to submit guess");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-6">
      <div className="text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Guess a number between <span className="font-semibold">{min}</span> and <span className="font-semibold">{max}</span>
        </p>
      </div>

      <div>
        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
          <span>{guessedCount} of {totalPlayers} guessed</span>
        </div>
        <Progress value={(guessedCount / totalPlayers) * 100} className="h-2" />
      </div>

      <div className="border rounded-lg p-4 space-y-2">
        {players.map((p) => {
          const guessed = state.answeredTokenIds.has(`guess_${p.playerId}`);
          const isCurrent = p.playerId === state.currentPlayerId;
          return (
            <div key={p.playerId} className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs">{p.username[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium flex-1">{p.username}</span>
              {guessed ? (
                <Badge variant="secondary" className="text-xs">✓ guessed</Badge>
              ) : isCurrent ? (
                <Badge className="text-xs">guessing...</Badge>
              ) : null}
              {p.playerId === currentUserId && (
                <span className="text-xs text-muted-foreground">you</span>
              )}
            </div>
          );
        })}
      </div>

      {isMyTurn && !hasGuessed ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <Input
            type="number"
            min={min}
            max={max}
            value={guess}
            onChange={(e) => setGuess(e.target.value)}
            placeholder={`${min}–${max}`}
            className="text-center text-lg font-mono"
            autoFocus
          />
          <Button type="submit" className="w-full" disabled={submitting || !guess}>
            {submitting ? "Submitting..." : "Submit Guess"}
          </Button>
        </form>
      ) : !hasGuessed ? (
        <p className="text-center text-sm text-muted-foreground py-4">
          Waiting for <span className="font-medium">{currentPlayer?.username ?? "..."}</span> to guess...
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-4">
          Your guess is in! Waiting for others...
        </p>
      )}
    </div>
  );
}
