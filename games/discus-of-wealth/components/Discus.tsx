"use client";
import type { Wedge } from "../board";

/** How long a spin takes to come to rest. */
export const SPIN_MS = 3000;

// Cash wedges take these in turn; Bankrupt is black and Lose a Turn white, as on the show.
const COLORS = ["#e4572e", "#f3a712", "#29bf12", "#2aa7de", "#a24cc2", "#ef476f", "#ffd166", "#06a77d"];
const TOP_COLOR = "#d4af37";
const RADIUS = 96;

/** A point `r` out from the centre, `deg` clockwise from the top. */
const at = (deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`;
};

/**
 * The discus, turned so the wedge the last spin landed on sits under the
 * pointer. `spins` counts every spin, so each one turns it a few full times
 * first — even one that lands where the last did.
 */
export function Discus({ wedges, landed, spins }: { wedges: Wedge[]; landed: number | null; spins: number }) {
  const slice = 360 / wedges.length;
  const rotation = spins * 3 * 360 - (landed ?? 0) * slice;
  const top = Math.max(...wedges.map((w) => (w.kind === "cash" ? w.value : 0)));

  return (
    <div className="relative mx-auto w-full max-w-[18rem] aspect-square">
      {/* The pointer */}
      <div className="absolute left-1/2 -top-1 z-10 -translate-x-1/2 w-0 h-0 border-x-[10px] border-x-transparent border-t-[18px] border-t-dooks" />
      <svg
        viewBox="-100 -100 200 200"
        className="w-full h-full drop-shadow-md"
        style={{ transform: `rotate(${rotation}deg)`, transition: `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.7, 0.2, 1)` }}
        role="img"
        aria-label="The discus"
      >
        <circle r={RADIUS + 3} fill="#5b3a1b" />
        {wedges.map((w, i) => {
          const from = i * slice - slice / 2;
          const to = from + slice;
          const fill =
            w.kind === "bankrupt" ? "#111" : w.kind === "lose" ? "#f8f8f8" : w.value === top ? TOP_COLOR : COLORS[i % COLORS.length];
          const label = w.kind === "bankrupt" ? "BANKRUPT" : w.kind === "lose" ? "LOSE A TURN" : String(w.value);
          return (
            <g key={i}>
              <path d={`M 0 0 L ${at(from, RADIUS)} A ${RADIUS} ${RADIUS} 0 0 1 ${at(to, RADIUS)} Z`} fill={fill} stroke="#5b3a1b" strokeWidth="0.6" />
              <text
                transform={`rotate(${i * slice}) translate(0 ${-RADIUS + 6}) rotate(90)`}
                fill={w.kind === "bankrupt" ? "#fff" : "#111"}
                fontSize={w.kind === "cash" ? 9 : 6}
                fontWeight="700"
                dominantBaseline="middle"
              >
                {label}
              </text>
            </g>
          );
        })}
        <circle r="22" fill="#8b5a2b" stroke="#5b3a1b" strokeWidth="2" />
        <circle r="10" fill="#c08a55" />
      </svg>
    </div>
  );
}
