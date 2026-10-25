"use client";
import { useLayoutEffect, useRef } from "react";
import type { Wedge } from "../board";

// The spin: a fast start that friction slows to a crawl, then, sometimes, a
// rock back off a peg the flapper wouldn't let past.
const TURN_MS = 3500;
const ROCK_MS = 450;
/** How long a spin takes to come to rest. */
export const SPIN_MS = TURN_MS + ROCK_MS;
const MIN_TURNS = 2;
/** Higher: a longer crawl at the end. */
const FRICTION = 3;

// The flapper rests on the pegs at the wedge boundaries: a peg within
// CONTACT degrees of it bends it, up to MAX_BEND, and it springs back once
// the peg slips past.
const CONTACT = 3.5;
const MAX_BEND = 32;
const SPRING = 900;
const DAMPING = 22;

// Cash wedges take these in turn; Bankrupt is black and Lose a Turn white, as on the show.
const COLORS = ["#e4572e", "#f3a712", "#29bf12", "#2aa7de", "#a24cc2", "#ef476f", "#ffd166", "#06a77d"];
const TOP_COLOR = "#d4af37";
const RADIUS = 96;
const PEG_RADIUS = 93;
/** Where the flapper sits, clockwise from the top: at the bottom, as on the show. */
const POINTER = 180;

/** A point `r` out from the centre, `deg` clockwise from the top. */
const at = (deg: number, r: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return `${(r * Math.cos(rad)).toFixed(2)} ${(r * Math.sin(rad)).toFixed(2)}`;
};
const mod = (n: number, m: number) => ((n % m) + m) % m;

/** The same few random numbers for every browser watching a given spin. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/**
 * Where in the landed wedge a spin stops, as the angle of the wedge's centre
 * from the pointer, and, when the flapper holds it back, where it was before
 * rocking back. About a third of spins just tip over the last peg, a third
 * are held back from the next one, and the rest stop near the middle.
 */
function ending(spins: number, slice: number): { rest: number; held: number | null } {
  const random = seeded(spins * 7919);
  const style = random();
  const half = slice / 2;
  if (style < 0.35) return { rest: -half + 1.2, held: null }; // crept over the peg
  if (style < 0.7) return { rest: half - CONTACT - 0.6, held: half - CONTACT * 0.45 }; // the flapper held it
  return { rest: (random() - 0.5) * (slice - 6), held: null };
}

/**
 * The discus, turned so the wedge the last spin landed on sits at the
 * flapper. `spins` counts every spin, so each one animates — even one that
 * lands where the last did. The server chose the wedge; this only shows it.
 */
export function Discus({ wedges, landed, spins }: { wedges: Wedge[]; landed: number | null; spins: number }) {
  const slice = 360 / wedges.length;
  const top = Math.max(...wedges.map((w) => (w.kind === "cash" ? w.value : 0)));
  const disc = useRef<SVGSVGElement>(null);
  const flapper = useRef<HTMLDivElement>(null);
  const angle = useRef<number | null>(null);
  // The spin last shown: a re-run for the same one (React's strict mode does that) mustn't spin again.
  const shown = useRef<number | null>(null);

  // Before the browser paints, so the discus never flashes unturned.
  useLayoutEffect(() => {
    const restAt = (offset: number) => POINTER - (landed ?? 0) * slice + offset;
    const { rest, held } = ending(spins, slice);
    const bend = { now: 0, speed: 0 };

    const paint = (a: number, dt: number) => {
      // At speed, pegs pass between frames: flick the flapper for each one that did.
      const crossed = angle.current !== null && Math.floor((a - POINTER - slice / 2) / slice) !== Math.floor((angle.current - POINTER - slice / 2) / slice);
      angle.current = a;
      if (disc.current) disc.current.style.transform = `rotate(${a}deg)`;
      // The peg nearest the flapper on the side it comes from (turning clockwise, at the bottom, the right).
      const peg = mod(a - POINTER - slice / 2, slice) - slice;
      if (peg >= -CONTACT) {
        bend.now = -MAX_BEND * (1 + peg / CONTACT);
        bend.speed = 0;
      } else {
        if (crossed && dt > 0) bend.now = Math.min(bend.now, -MAX_BEND * 0.7);
        bend.speed += (-SPRING * bend.now - DAMPING * bend.speed) * dt;
        bend.now += bend.speed * dt;
      }
      if (flapper.current) flapper.current.style.transform = `translateX(-50%) rotate(${bend.now}deg)`;
    };

    // First render, or someone who'd rather not watch it spin: straight to where it stopped.
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isNew = angle.current !== null && shown.current !== spins;
    shown.current = spins;
    if (!isNew || still) {
      paint(restAt(rest), 0);
      return;
    }

    const from = angle.current!;
    const stop = restAt(held ?? rest);
    const to = from + mod(stop - from, 360) + MIN_TURNS * 360;
    const started = performance.now();
    let last = started;
    let frame = requestAnimationFrame(function tick(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = now - started;
      if (t < TURN_MS) {
        paint(from + (to - from) * (1 - (1 - t / TURN_MS) ** FRICTION), dt);
      } else if (held !== null && t < SPIN_MS) {
        // The flapper pushes it back off the peg.
        const u = (t - TURN_MS) / ROCK_MS;
        paint(to + (held - rest) * -(1 - (1 - u) ** 2), dt);
      } else {
        paint(to - (held === null ? 0 : held - rest), dt);
        if (Math.abs(bend.now) < 0.1 && t > SPIN_MS) return;
      }
      frame = requestAnimationFrame(tick);
    });
    return () => {
      cancelAnimationFrame(frame);
      paint(to - (held === null ? 0 : held - rest), 0);
    };
  }, [spins, landed, slice]);

  return (
    <div className="relative mx-auto w-full max-w-[18rem] aspect-square">
      {/* The flapper, hinged at the bottom */}
      <div
        ref={flapper}
        className="absolute left-1/2 -bottom-1 z-10 w-0 h-0 border-x-[7px] border-x-transparent border-b-[22px] border-b-dooks origin-bottom drop-shadow"
        style={{ transform: "translateX(-50%)" }}
      />
      <svg ref={disc} viewBox="-100 -100 200 200" className="w-full h-full drop-shadow-md" role="img" aria-label="The discus">
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
                transform={`rotate(${i * slice}) translate(0 ${-RADIUS + 8}) rotate(90)`}
                fill={w.kind === "bankrupt" ? "#fff" : "#111"}
                fontSize={w.kind === "cash" ? 9 : 6}
                fontWeight="700"
                dominantBaseline="middle"
              >
                {label}
              </text>
              {/* The peg on this wedge's leading edge */}
              <circle
                transform={`rotate(${from})`}
                cy={-PEG_RADIUS}
                r="1.8"
                fill="#f1e3c8"
                stroke="#5b3a1b"
                strokeWidth="0.5"
              />
            </g>
          );
        })}
        <circle r="22" fill="#8b5a2b" stroke="#5b3a1b" strokeWidth="2" />
        <circle r="10" fill="#c08a55" />
      </svg>
    </div>
  );
}
