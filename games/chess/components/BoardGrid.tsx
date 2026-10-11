"use client";
import type { Chess, Square } from "chess.js";
import type { Side } from "../clock";

// The filled glyphs for both colors (tinted via CSS), with a text variation
// selector so phones don't swap the pawn for an emoji.
const GLYPHS: Record<string, string> = {
  k: "♚︎",
  q: "♛︎",
  r: "♜︎",
  b: "♝︎",
  n: "♞︎",
  p: "♟︎",
};
const PIECE_NAMES: Record<string, string> = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = ["8", "7", "6", "5", "4", "3", "2", "1"];

const WHITE_PIECE_STYLE = { color: "#fff", textShadow: "0 0 2px #000, 0 0 2px #000, 0 1px 2px #000" };
const BLACK_PIECE_STYLE = { color: "#1c1917", textShadow: "0 0 1px rgba(255,255,255,0.6)" };

interface BoardGridProps {
  chess: Chess;
  orientation: Side;
  selected?: Square | null;
  targets?: Set<string>;
  lastMove?: { from: string; to: string } | null;
  checkSquare?: string | null;
  disabled?: boolean;
  onSquareClick?: (square: Square) => void;
}

export function PieceGlyph({ type, color }: { type: string; color: "w" | "b" }) {
  return (
    <span aria-hidden className="leading-none select-none" style={color === "w" ? WHITE_PIECE_STYLE : BLACK_PIECE_STYLE}>
      {GLYPHS[type]}
    </span>
  );
}

export function BoardGrid({
  chess,
  orientation,
  selected,
  targets,
  lastMove,
  checkSquare,
  disabled,
  onSquareClick,
}: BoardGridProps) {
  const files = orientation === "white" ? FILES : [...FILES].reverse();
  const ranks = orientation === "white" ? RANKS : [...RANKS].reverse();

  return (
    <div className="grid grid-cols-8 w-full max-w-md mx-auto aspect-square rounded-md overflow-hidden border text-[min(9.5vw,2.9rem)]">
      {ranks.map((rank, r) =>
        files.map((file, f) => {
          const square = `${file}${rank}` as Square;
          const piece = chess.get(square);
          const isDark = (FILES.indexOf(file) + Number(rank)) % 2 === 1;
          const isLastMove = lastMove?.from === square || lastMove?.to === square;
          const isTarget = targets?.has(square) ?? false;

          let background = isDark ? "#b58863" : "#f0d9b5";
          if (isLastMove) background = isDark ? "#aaa23a" : "#cdd26a";
          if (selected === square) background = "#829769";
          if (checkSquare === square) background = "#e5533d";

          const label = piece
            ? `${square}, ${piece.color === "w" ? "white" : "black"} ${PIECE_NAMES[piece.type]}`
            : square;

          return (
            <button
              key={square}
              type="button"
              data-square={square}
              data-piece={piece ? `${piece.color}${piece.type}` : undefined}
              data-target={isTarget || undefined}
              aria-label={label}
              disabled={disabled || !onSquareClick}
              onClick={() => onSquareClick?.(square)}
              className="relative flex items-center justify-center aspect-square disabled:cursor-default"
              style={{ background }}
            >
              {piece && <PieceGlyph type={piece.type} color={piece.color} />}
              {isTarget &&
                (piece ? (
                  <span className="absolute inset-0.5 rounded-full border-4 border-black/25" />
                ) : (
                  <span className="absolute h-[28%] w-[28%] rounded-full bg-black/25" />
                ))}
              {f === 0 && (
                <span className="absolute top-0.5 left-0.5 text-[9px] font-semibold leading-none" style={{ color: isDark ? "#f0d9b5" : "#b58863" }}>
                  {rank}
                </span>
              )}
              {r === 7 && (
                <span className="absolute bottom-0.5 right-0.5 text-[9px] font-semibold leading-none" style={{ color: isDark ? "#f0d9b5" : "#b58863" }}>
                  {file}
                </span>
              )}
            </button>
          );
        })
      )}
    </div>
  );
}

/** "1. e4 e5 2. Nf3 …" as numbered pairs. */
export function MoveList({ moves }: { moves: string[] }) {
  if (moves.length === 0) return null;
  const pairs: string[][] = [];
  for (let i = 0; i < moves.length; i += 2) pairs.push(moves.slice(i, i + 2));
  return (
    <div className="border rounded-lg p-3 max-h-32 overflow-y-auto text-sm font-mono leading-relaxed">
      {pairs.map((pair, i) => (
        <span key={i} className="inline-block mr-3">
          <span className="text-muted-foreground">{i + 1}.</span> {pair.join(" ")}
        </span>
      ))}
    </div>
  );
}
