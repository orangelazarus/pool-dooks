"use client";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Crown,
  Handshake,
  Pause,
  Play,
} from "lucide-react";
import { timeControlLabel, type Side } from "../clock";
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

/** How long autoplay shows each position. */
const AUTOPLAY_MS = 1000;

/** Arrow keys belong to whatever is being typed in, such as the chat box. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function ChessReveal({ title, timeControlSeconds, white, black, moves, result, resultReason }: ChessRevealProps) {
  // How many moves have been played on the board shown: 0 is the starting
  // position, moves.length the final one, which is where the replay opens.
  const [ply, setPly] = useState(moves.length);
  const [playing, setPlaying] = useState(false);
  const [orientation, setOrientation] = useState<Side>("white");

  const go = (next: number) => setPly(Math.max(0, Math.min(moves.length, next)));
  const step = (by: number) => {
    setPlaying(false);
    go(ply + by);
  };
  const jump = (to: number) => {
    setPlaying(false);
    go(to);
  };

  const chess = useMemo(() => replay(moves.slice(0, ply)), [moves, ply]);
  const history = chess.history({ verbose: true });
  const last = history[history.length - 1];
  const checkSquare = chess.isCheck() ? chess.findPiece({ type: "k", color: chess.turn() })[0] : null;
  const atEnd = ply === moves.length;

  // Autoplay: one move a second, stopping at the end.
  useEffect(() => {
    if (!playing || ply >= moves.length) return;
    const timer = setTimeout(() => {
      setPly(ply + 1);
      if (ply + 1 >= moves.length) setPlaying(false);
    }, AUTOPLAY_MS);
    return () => clearTimeout(timer);
  }, [playing, ply, moves.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      const to = { ArrowLeft: ply - 1, ArrowRight: ply + 1, Home: 0, End: moves.length }[e.key];
      if (to === undefined) return;
      e.preventDefault();
      setPlaying(false);
      setPly(Math.max(0, Math.min(moves.length, to)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ply, moves.length]);

  const togglePlay = () => {
    if (playing) return setPlaying(false);
    if (atEnd) setPly(0); // Play from the start again.
    setPlaying(true);
  };

  const position =
    ply === 0
      ? "Starting position"
      : `${Math.ceil(ply / 2)}.${ply % 2 === 0 ? ".." : ""} ${moves[ply - 1]} · move ${ply} of ${moves.length}`;

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
        <div className="flex items-center justify-center gap-2 text-primary">
          {result === "draw" ? <Handshake className="h-5 w-5" /> : <Crown className="h-5 w-5" />}
          <span className="font-semibold text-lg">{describeResult(result, resultReason, { white, black })}</span>
        </div>
      )}

      <div className="space-y-3">
        <p className="text-sm text-muted-foreground text-center">{orientation === "white" ? black : white}</p>
        <BoardGrid
          chess={chess}
          orientation={orientation}
          lastMove={last ? { from: last.from, to: last.to } : null}
          checkSquare={checkSquare}
        />
        <p className="text-sm text-muted-foreground text-center">{orientation === "white" ? white : black}</p>

        {moves.length > 0 && (
          <div className="max-w-md mx-auto space-y-2" data-replay>
            <p className="text-center text-sm font-mono" data-replay-position>
              {position}
            </p>
            <input
              type="range"
              min={0}
              max={moves.length}
              value={ply}
              onChange={(e) => jump(Number(e.target.value))}
              aria-label="Move"
              className="w-full accent-primary"
            />
            <div className="flex items-center justify-center gap-1">
              <Button size="icon" variant="outline" aria-label="Start" disabled={ply === 0} onClick={() => jump(0)}>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" aria-label="Previous move" disabled={ply === 0} onClick={() => step(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={togglePlay}>
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="outline" aria-label="Next move" disabled={atEnd} onClick={() => step(1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="outline" aria-label="End" disabled={atEnd} onClick={() => jump(moves.length)}>
                <ChevronsRight className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Flip board"
                onClick={() => setOrientation((o) => (o === "white" ? "black" : "white"))}
              >
                <ArrowUpDown className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground hidden sm:block">
              Arrow keys step through the game; Home and End jump to the start and the finish.
            </p>
          </div>
        )}
      </div>

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
          Moves ({Math.ceil(moves.length / 2)})
        </h3>
        <MoveList moves={moves} current={ply} onSelect={jump} />
      </div>
    </div>
  );
}
