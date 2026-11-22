// The computer opponent: Stockfish (lite, single-threaded WASM build) in a
// child Node process, spoken to over UCI. Server-side only.
//
// It runs as its own process, started from the file on disk, rather than being
// imported: the engine loads its .wasm next to itself at runtime, which Next's
// server bundle would break. One process serves every game; UCI handles one
// search at a time, so requests queue.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Level } from "./engine";

const ENGINE = join(process.cwd(), "node_modules", "stockfish", "bin", "stockfish-19-lite-single.js");

// Skill Level 0–20 makes Stockfish pick weaker moves on purpose; the time cap
// keeps every search short on a small server.
const SETTINGS: Record<Level, { skill: number; movetimeMs: number }> = {
  easy: { skill: 0, movetimeMs: 100 },
  medium: { skill: 8, movetimeMs: 200 },
  hard: { skill: 20, movetimeMs: 500 },
};
const EVALUATE_MS = 200;
const SEARCH_TIMEOUT_MS = 10_000;
/** Searches waiting beyond this are refused rather than queued. */
const MAX_QUEUE = 20;
/** A forced mate, as a score. */
export const MATE_SCORE = 100_000;

// Only a position goes to the engine, never other text: a newline in it would
// be a second UCI command. The FEN comes from chess.js, so this never fails in
// practice; it is a backstop.
const FEN = /^[1-8pnbrqkPNBRQK/]{15,71} [wb] (-|[KQkq]{1,4}) (-|[a-h][36]) \d{1,3} \d{1,4}$/;

type Engine = { proc: ChildProcessWithoutNullStreams; waiters: ((line: string) => boolean)[] };
let engine: Engine | null = null;
let queue: Promise<unknown> = Promise.resolve();
let queued = 0;

function start(): Engine {
  const proc = spawn(process.execPath, [ENGINE], { stdio: "pipe" });
  const self: Engine = { proc, waiters: [] };
  createInterface({ input: proc.stdout }).on("line", (line) => {
    // Each waiter returns true once it has the line it was waiting for.
    self.waiters = self.waiters.filter((w) => !w(line));
  });
  const gone = () => {
    if (engine === self) engine = null;
  };
  proc.on("exit", gone);
  proc.on("error", gone);
  proc.stdin.on("error", gone);
  return self;
}

function send(cmd: string) {
  engine!.proc.stdin.write(cmd + "\n");
}

/** Waits for a line matching `match`, collecting every line seen until then. */
function until(match: (line: string) => boolean, seen?: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const current = engine!;
    const timer = setTimeout(() => {
      current.proc.kill(); // Wedged: the next request starts a fresh one.
      reject(new Error("Chess engine timed out"));
    }, SEARCH_TIMEOUT_MS);
    current.waiters.push((line) => {
      seen?.push(line);
      if (!match(line)) return false;
      clearTimeout(timer);
      resolve(line);
      return true;
    });
  });
}

/** Runs searches one at a time, in order. */
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  if (queued >= MAX_QUEUE) return Promise.reject(new Error("Chess engine busy"));
  queued++;
  const result = queue.then(job, job).finally(() => queued--);
  queue = result.catch(() => {});
  return result;
}

/** The best move found and its score for the side to move, in centipawns. */
async function search(fen: string, skill: number, movetimeMs: number): Promise<{ move: string | null; score: number }> {
  if (!FEN.test(fen)) throw new Error("Not a chess position");
  if (!engine) {
    engine = start();
    send("uci");
    await until((l) => l === "uciok");
  }
  send("ucinewgame");
  send(`setoption name Skill Level value ${skill}`);
  send("isready");
  await until((l) => l === "readyok");
  send(`position fen ${fen}`);
  send(`go movetime ${movetimeMs}`);
  const lines: string[] = [];
  const best = await until((l) => l.startsWith("bestmove"), lines);

  let score = 0;
  for (const line of lines) {
    const m = / score (cp|mate) (-?\d+)/.exec(line);
    if (!m) continue;
    const n = Number(m[2]);
    score = m[1] === "cp" ? n : n > 0 ? MATE_SCORE : -MATE_SCORE;
  }
  const move = best.split(" ")[1];
  return { move: !move || move === "(none)" ? null : move, score };
}

/**
 * The computer's move in this position, in UCI notation ("e2e4", "e7e8q").
 * Null if it has none (the game is over).
 */
export function computerMove(fen: string, level: Level): Promise<string | null> {
  const { skill, movetimeMs } = SETTINGS[level];
  return enqueue(async () => (await search(fen, skill, movetimeMs)).move);
}

/** How good the position is for the side to move, in centipawns (±MATE_SCORE for a forced mate). */
export function evaluate(fen: string): Promise<number> {
  return enqueue(async () => (await search(fen, 20, EVALUATE_MS)).score);
}
