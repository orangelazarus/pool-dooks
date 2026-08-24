"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useGameState } from "@/hooks/useGameState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { TOKEN_COLORS } from "@/components/editor/BlankNode";
import { toast } from "sonner";
import { Send, Clock } from "lucide-react";
import type { PoolDookToken } from "@/lib/db/schema";

const HINTS: Array<{ types: string[]; check: (v: string) => boolean; message: string }> = [
  {
    types: ["plural noun"],
    check: (v) => !v.toLowerCase().endsWith("s"),
    message: 'Plural nouns usually end in "s" (e.g. cats, dogs)',
  },
  {
    types: ["verb -ing"],
    check: (v) => !v.toLowerCase().endsWith("ing"),
    message: 'Should end in "-ing" (e.g. running, jumping)',
  },
  {
    types: ["verb past tense"],
    check: (v) => !v.toLowerCase().endsWith("ed"),
    message: 'Regular past tense ends in "-ed" — irregular is fine too (e.g. ran, went)',
  },
];

function getHint(type: string | undefined, value: string): string | null {
  if (!type || !value.trim()) return null;
  const rule = HINTS.find((h) => h.types.includes(type));
  if (!rule) return null;
  return rule.check(value.trim()) ? rule.message : null;
}

interface GameBoardProps {
  shareCode: string;
  currentUserId: string;
  hostId: string;
  tokenOrder: string[];
  tokens: PoolDookToken[];
  initialCurrentTokenId: string;
  initialCurrentPlayerId: string;
  initialTokenIndex: number;
  players: Array<{ playerId: string; username: string; avatarUrl?: string | null }>;
}

export function GameBoard({
  shareCode,
  currentUserId,
  tokenOrder,
  tokens,
  initialCurrentTokenId,
  initialCurrentPlayerId,
  initialTokenIndex,
  players,
}: GameBoardProps) {
  const router = useRouter();
  const [answer, setAnswer] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const tokenMap = new Map(tokens.map((t) => [t.id, t]));

  const { state, handleEvent } = useGameState(players);

  // Initialize from server-side state
  const [gameState, setGameState] = useState({
    currentTokenId: initialCurrentTokenId,
    currentPlayerId: initialCurrentPlayerId,
    tokenIndex: initialTokenIndex,
    answeredIds: new Set<string>(),
  });

  useSession(shareCode, (event) => {
    handleEvent(event);
    if (event.type === "turn:changed") {
      setGameState((prev) => ({
        ...prev,
        currentTokenId: event.payload.currentTokenId,
        currentPlayerId: event.payload.currentPlayerId,
        tokenIndex: event.payload.tokenIndex,
      }));
      setAnswer("");
    }
    if (event.type === "answer:confirmed") {
      setGameState((prev) => ({
        ...prev,
        answeredIds: new Set([...prev.answeredIds, event.payload.tokenId]),
      }));
    }
    if (event.type === "session:completed" || event.type === "session:revealed") {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });

  const isMyTurn = gameState.currentPlayerId === currentUserId;
  const currentToken = tokenMap.get(gameState.currentTokenId);

  const hint = getHint(currentToken?.type, answer);
  const progress = (gameState.tokenIndex / tokenOrder.length) * 100;
  const currentPlayer = players.find((p) => p.playerId === gameState.currentPlayerId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!answer.trim() || !isMyTurn) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: gameState.currentTokenId, value: answer.trim() }),
      });
      let data: { ok?: boolean; isComplete?: boolean; error?: string } = {};
      try { data = await res.json(); } catch { /* empty body */ }
      if (!res.ok) throw new Error(data.error ?? `Server error ${res.status}`);
      if (data.isComplete) {
        router.push(`/sessions/${shareCode}/reveal`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      {/* Progress */}
      <div className="mb-6">
        <div className="flex justify-between text-xs text-muted-foreground mb-1.5">
          <span>Blank {gameState.tokenIndex + 1} of {tokenOrder.length}</span>
          <span>{Math.round(progress)}% complete</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* Blank list — filled ones greyed out */}
      <div className="space-y-2 mb-8">
        {tokenOrder.map((tokenId, idx) => {
          const token = tokenMap.get(tokenId);
          const isAnswered = gameState.answeredIds.has(tokenId);
          const isCurrent = tokenId === gameState.currentTokenId;

          return (
            <div
              key={`${tokenId}-${idx}`}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-all ${
                isCurrent
                  ? "border-primary bg-primary/5 shadow-sm"
                  : isAnswered
                  ? "border-green-200 bg-green-50 opacity-60"
                  : "border-border bg-muted/30"
              }`}
            >
              <span className="text-xs font-mono text-muted-foreground w-5 text-center">
                {idx + 1}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-xs font-medium border flex-1 ${
                  TOKEN_COLORS[token?.type ?? "custom"]
                }`}
              >
                {token?.label ?? tokenId}
              </span>
              {isAnswered && (
                <span className="text-green-600 text-xs">✓</span>
              )}
              {isCurrent && (
                <Badge variant="secondary" className="text-xs">Now</Badge>
              )}
            </div>
          );
        })}
      </div>

      {/* Turn indicator + input */}
      {state.status !== "completed" && (
        <div className="border rounded-xl p-5 space-y-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9">
              <AvatarImage src={currentPlayer?.avatarUrl ?? undefined} />
              <AvatarFallback className="text-xs">
                {currentPlayer?.username[0]?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-sm font-medium">
                {isMyTurn ? "Your turn!" : `${currentPlayer?.username}'s turn`}
              </p>
              <p className="text-xs text-muted-foreground">
                Fill in: <span className="font-medium">{currentToken?.label}</span>
              </p>
            </div>
          </div>

          {isMyTurn ? (
            <form onSubmit={handleSubmit} className="space-y-1.5">
              <div className="flex gap-2">
                <Input
                  value={answer}
                  onChange={(e) => setAnswer(e.target.value)}
                  placeholder={`Enter a ${currentToken?.type ?? "word"}...`}
                  autoFocus
                  className="flex-1"
                />
                <Button type="submit" disabled={submitting || !answer.trim()} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              {hint && (
                <p className="text-xs text-amber-600 flex items-center gap-1">
                  <span>⚠</span> {hint}
                </p>
              )}
            </form>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Clock className="h-4 w-4 animate-pulse" />
              <span>Waiting for their answer...</span>
            </div>
          )}
        </div>
      )}

      {state.status === "completed" && (
        <div className="text-center py-6 border rounded-xl bg-muted/30">
          <p className="font-medium">All blanks filled!</p>
          <p className="text-sm text-muted-foreground mt-1">Revealing the story...</p>
        </div>
      )}
    </div>
  );
}
