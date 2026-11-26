"use client";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { CANVAS_SIZE, COLORS, SIZES, decodeDrawing, strokePath } from "../drawing";

/** A finished drawing, scaled to fit its box. Always on white, whatever the theme. */
export function DrawingView({ drawing, className }: { drawing: string; className?: string }) {
  const strokes = useMemo(() => decodeDrawing(drawing) ?? [], [drawing]);
  return (
    <svg
      viewBox={`0 0 ${CANVAS_SIZE} ${CANVAS_SIZE}`}
      className={cn("block w-full max-w-[60vh] mx-auto aspect-square rounded-lg border bg-white", className)}
      role="img"
      aria-label="A player's drawing"
    >
      {strokes.map((s, i) => (
        <path
          key={i}
          d={strokePath(s.points)}
          fill="none"
          stroke={COLORS[s.color]}
          strokeWidth={SIZES[s.size]}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
