"use client";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Crown, Handshake } from "lucide-react";
import { timeControlLabel } from "../clock";
import { describeResult, replay, type GameResult, type ResultReason } from "../engine";
import { BoardGrid, MoveList } from "./BoardGrid";

interface ChessRevealProps {
  title: string;
  timeControlSeconds: number | null;
  white: string;
  black: string;
  moves: string[];
  result: GameResult | null;
  resultReason: ResultReason | null;
}

export function ChessReveal({ title, timeControlSeconds, white, black, moves, result, resultReason }: ChessRevealProps) {
  const chess = useMemo(() => replay(moves), [moves]);
  const history = chess.history({ verbose: true });
  const last = history[history.length - 1];
  const checkSquare = chess.isCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : null;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold">{title}</h2>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{timeControlLabel(timeControlSeconds)}</Badge>
          <span>
            {white} (white) vs {black} (black)
          </span>
        </div>
      </div>

      {result && resultReason && (
        <div className="flex items-center justify-center gap-2 text-yellow-600">
          {result === "draw" ? <Handshake className="h-5 w-5" /> : <Crown className="h-5 w-5" />}
          <span className="font-semibold text-lg">{describeResult(result, resultReason, { white, black })}</span>
        </div>
      )}

      <BoardGrid
        chess={chess}
        orientation="white"
        lastMove={last ? { from: last.from, to: last.to } : null}
        checkSquare={checkSquare}
      />

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
          Moves ({Math.ceil(moves.length / 2)})
        </h3>
        <MoveList moves={moves} />
      </div>
    </div>
  );
}
