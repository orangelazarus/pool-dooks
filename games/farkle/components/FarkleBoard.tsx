"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { useSession } from "@/hooks/useSession";
import { useGameState } from "@/hooks/useGameState";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Dice1, Dice2, Dice3, Dice4, Dice5, Dice6 } from "lucide-react";
import { scoreSelection, RULESETS, type Ruleset } from "../scoring";

const DICE_ICONS = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];

interface FarkleBoardProps {
  shareCode: string;
  currentUserId: string;
  players: Array<{ playerId: string; username: string; avatarUrl?: string | null }>;
  title: string;
  targetScore: number;
  ruleset: Ruleset;
  initialCurrentPlayerId: string;
  initialDice: number[] | null;
  initialDiceRemaining: number;
  initialTurnScore: number;
  initialRollsThisTurn: number;
  initialScores: Record<string, number>;
}

interface TurnState {
  currentPlayerId: string;
  dice: number[] | null;
  diceRemaining: number;
  turnScore: number;
  rollsThisTurn: number;
  scores: Record<string, number>;
}

export function FarkleBoard({
  shareCode,
  currentUserId,
  players,
  title,
  targetScore,
  ruleset,
  initialCurrentPlayerId,
  initialDice,
  initialDiceRemaining,
  initialTurnScore,
  initialRollsThisTurn,
  initialScores,
}: FarkleBoardProps) {
  const router = useRouter();
  const [turn, setTurn] = useState<TurnState>({
    currentPlayerId: initialCurrentPlayerId,
    dice: initialDice,
    diceRemaining: initialDiceRemaining,
    turnScore: initialTurnScore,
    rollsThisTurn: initialRollsThisTurn,
    scores: initialScores,
  });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rollKey, setRollKey] = useState(0);

  const { state, handleEvent } = useGameState(players, {
    tokenOrder: [],
    currentTokenId: null,
    currentPlayerId: initialCurrentPlayerId,
    tokenIndex: 0,
  });

  useSession(shareCode, (event) => {
    handleEvent(event);
    if (event.type === "farkle:state") {
      // Another client's action — reflect it live for every open browser,
      // not just the player taking the turn.
      setTurn({
        currentPlayerId: event.payload.currentPlayerId,
        dice: event.payload.dice,
        diceRemaining: event.payload.diceRemaining,
        turnScore: event.payload.turnScore,
        rollsThisTurn: event.payload.rollsThisTurn,
        scores: event.payload.scores,
      });
      setSelected(new Set());
      setRollKey((k) => k + 1);
      if (event.payload.farkled) toast.error("Farkle! Turn lost.");
      if (event.payload.hotDice) toast.success("Hot dice! All six back in play.");
      if (event.payload.banked && event.payload.bankedAmount) {
        toast.success(`Banked ${event.payload.bankedAmount} points!`);
      }
    }
    if (event.type === "session:completed" || event.type === "session:revealed") {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });

  const isMyTurn = turn.currentPlayerId === currentUserId;
  const currentPlayer = players.find((p) => p.playerId === turn.currentPlayerId);
  const meta = RULESETS[ruleset];
  const hasBankedBefore = (turn.scores[currentUserId] ?? 0) > 0;
  const minEntry = meta.minEntryScore;
  const needsEntry = !hasBankedBefore && turn.turnScore < minEntry;

  const selectedDice = turn.dice ? [...selected].map((i) => turn.dice![i]) : [];
  const preview = selectedDice.length > 0 ? scoreSelection(selectedDice, ruleset) : null;

  const toggleDie = (index: number) => {
    if (!isMyTurn || !turn.dice || busy) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  async function call(action: "roll" | "keep" | "bank", body?: unknown) {
    setBusy(true);
    try {
      const res = await fetch(`/api/games/farkle/${shareCode}/${action}`, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      return data;
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      return null;
    } finally {
      setBusy(false);
    }
  }

  const handleRoll = async () => {
    const data = await call("roll");
    if (!data) return;
    setSelected(new Set());
    setRollKey((k) => k + 1);
    setTurn((prev) => ({
      ...prev,
      currentPlayerId: data.currentPlayerId,
      dice: data.farkled ? null : data.dice,
      diceRemaining: data.diceRemaining,
      turnScore: data.turnScore,
      scores: data.scores,
    }));
    if (data.farkled) toast.error("Farkle! Turn lost.");
  };

  const handleKeep = async () => {
    if (!preview?.valid) return;
    const data = await call("keep", { diceIndices: [...selected] });
    if (!data) return;
    setSelected(new Set());
    setTurn((prev) => ({ ...prev, dice: null, diceRemaining: data.diceRemaining, turnScore: data.turnScore }));
    if (data.hotDice) toast.success("Hot dice! All six back in play.");
  };

  const handleBank = async () => {
    const data = await call("bank");
    if (!data) return;
    if (data.won) {
      router.push(`/sessions/${shareCode}/reveal`);
      return;
    }
    setTurn((prev) => ({
      ...prev,
      currentPlayerId: data.currentPlayerId ?? prev.currentPlayerId,
      dice: null,
      diceRemaining: 6,
      turnScore: 0,
      scores: data.scores,
    }));
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <div className="text-center space-y-1">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">{meta.label}</Badge>
          <span>First to {targetScore}</span>
        </div>
      </div>

      <div className="border rounded-lg p-3 space-y-2">
        {state.players.map((p) => {
          const isCurrent = p.playerId === turn.currentPlayerId;
          return (
            <div key={p.playerId} className="flex items-center gap-3">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="text-xs">{p.username[0]?.toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium flex-1">
                {p.username}
                {p.playerId === currentUserId && <span className="text-xs text-muted-foreground"> (you)</span>}
              </span>
              {isCurrent && (
                <Badge className="text-xs">rolling…</Badge>
              )}
              <span className="font-mono text-sm font-semibold">{turn.scores[p.playerId] ?? 0}</span>
            </div>
          );
        })}
      </div>

      {isMyTurn && turn.turnScore > 0 && (
        <p className="text-center text-sm text-muted-foreground">
          This turn: <span className="font-semibold text-foreground">{turn.turnScore}</span> unbanked
        </p>
      )}

      {turn.dice ? (
        <div className="space-y-3">
          <AnimatePresence mode="wait">
            <motion.div
              key={rollKey}
              initial={{ opacity: 0, rotate: -8, scale: 0.85 }}
              animate={{ opacity: 1, rotate: 0, scale: 1 }}
              transition={{ type: "spring", stiffness: 300, damping: 18 }}
              className="grid grid-cols-6 gap-2 justify-items-center"
            >
              {turn.dice.map((face, i) => {
                const Icon = DICE_ICONS[face - 1];
                const isSelected = selected.has(i);
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!isMyTurn || busy}
                    onClick={() => toggleDie(i)}
                    className={`rounded-lg border p-2 transition-colors ${
                      isSelected ? "bg-primary text-primary-foreground border-primary" : "bg-card border-input"
                    } ${isMyTurn ? "cursor-pointer" : "cursor-default opacity-80"}`}
                  >
                    <Icon className="h-7 w-7" />
                  </button>
                );
              })}
            </motion.div>
          </AnimatePresence>

          {isMyTurn ? (
            <div className="text-center space-y-2">
              <p className="text-sm text-muted-foreground">
                {preview
                  ? preview.valid
                    ? `Worth ${preview.points} points`
                    : "Not a valid scoring selection"
                  : "Tap dice to set them aside"}
              </p>
              <Button
                className="w-full"
                disabled={!preview?.valid || busy}
                onClick={handleKeep}
              >
                Set Aside{preview?.valid ? ` (+${preview.points})` : ""}
              </Button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              <span className="font-medium">{currentPlayer?.username ?? "…"}</span> is choosing dice to keep…
            </p>
          )}
        </div>
      ) : isMyTurn ? (
        <div className="space-y-2">
          <Button className="w-full" onClick={handleRoll} disabled={busy}>
            Roll {turn.diceRemaining} {turn.diceRemaining === 1 ? "die" : "dice"}
          </Button>
          <Button
            className="w-full"
            variant="outline"
            onClick={handleBank}
            disabled={busy || turn.turnScore === 0 || needsEntry}
          >
            {needsEntry
              ? `Need ${minEntry}+ to open your account`
              : `Bank ${turn.turnScore} point${turn.turnScore === 1 ? "" : "s"}`}
          </Button>
        </div>
      ) : (
        <p className="text-center text-sm text-muted-foreground py-4">
          Waiting for <span className="font-medium">{currentPlayer?.username ?? "…"}</span> to roll…
        </p>
      )}
    </div>
  );
}
