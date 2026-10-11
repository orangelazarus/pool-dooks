// Pure clock math, shared by the server (plugin.ts is the only timekeeper)
// and the client (ChessBoard only animates the countdown). No DB/React imports.

export type Side = "white" | "black";

export interface TimeControl {
  seconds: number | null;
  label: string;
}

export const TIME_CONTROLS: TimeControl[] = [
  { seconds: null, label: "Untimed" },
  { seconds: 300, label: "5 min" },
  { seconds: 600, label: "10 min" },
  { seconds: 1800, label: "30 min" },
];

export function timeControlLabel(seconds: number | null): string {
  return TIME_CONTROLS.find((t) => t.seconds === seconds)?.label ?? `${Math.round((seconds ?? 0) / 60)} min`;
}

export interface ClockState {
  whiteMs: number | null;
  blackMs: number | null;
  // Epoch ms when the side to move's clock started running. Null while
  // untimed, and before White's first move — the clocks don't run until then.
  turnStartedAt: number | null;
}

/** Time left for `side` at `now`. Null means the game is untimed. */
export function remainingMs(clock: ClockState, side: Side, toMove: Side, now: number): number | null {
  const base = side === "white" ? clock.whiteMs : clock.blackMs;
  if (base === null) return null;
  if (side !== toMove || clock.turnStartedAt === null) return base;
  return Math.max(0, base - (now - clock.turnStartedAt));
}

export function formatClock(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
