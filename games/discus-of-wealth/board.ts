// The puzzle board and the discus, shared by the server and the browser. Holds
// no puzzles: those stay on the server (puzzles.ts).

/** The board is four rows of 14 columns; the top and bottom rows lose a tile at each end. */
export const COLUMNS = 14;
export const ROWS = [
  { start: 1, width: 12 },
  { start: 0, width: 14 },
  { start: 0, width: 14 },
  { start: 1, width: 12 },
] as const;

// Which rows a puzzle of 1–4 lines may use, best first.
const ROW_CHOICES: Record<number, number[][]> = {
  1: [[1]],
  2: [[1, 2]],
  3: [[0, 1, 2], [1, 2, 3]],
  4: [[0, 1, 2, 3]],
};

export const VOWELS = ["A", "E", "I", "O", "U"];
export const CONSONANTS = "BCDFGHJKLMNPQRSTVWXYZ".split("");
export const isLetter = (ch: string) => ch >= "A" && ch <= "Z";

/** On a masked board: a letter tile still turned over. */
export const HIDDEN = "_";

/**
 * Lays a puzzle out on the board: the fewest lines, then the most even ones,
 * each centred in its row. Words are never split. Returns four strings of
 * COLUMNS characters, a space meaning no tile; null if the puzzle doesn't fit.
 */
export function layoutBoard(puzzle: string): string[] | null {
  const words = puzzle.split(" ");
  // Lower is better: the longest line, then the gap between the longest and shortest.
  let best: { lines: string[]; rows: number[]; score: number } | null = null;

  for (let count = 1; count <= Math.min(4, words.length) && !best; count++) {
    for (const cuts of combinations(words.length - 1, count - 1)) {
      const bounds = [0, ...cuts.map((c) => c + 1), words.length];
      const lines = bounds.slice(0, -1).map((from, i) => words.slice(from, bounds[i + 1]).join(" "));
      const lengths = lines.map((l) => l.length);
      const score = Math.max(...lengths) * COLUMNS + Math.max(...lengths) - Math.min(...lengths);
      for (const rows of ROW_CHOICES[count]) {
        const fits = lines.every((line, i) => line.length <= ROWS[rows[i]].width);
        if (fits && (!best || score < best.score)) best = { lines, rows, score };
      }
    }
  }
  if (!best) return null;

  const board = ROWS.map(() => " ".repeat(COLUMNS));
  best.lines.forEach((line, i) => {
    const row = ROWS[best.rows[i]];
    const at = row.start + Math.floor((row.width - line.length) / 2);
    const current = board[best.rows[i]];
    board[best.rows[i]] = current.slice(0, at) + line + current.slice(at + line.length);
  });
  return board;
}

/** Every way to choose `k` cut points out of `n`, in order. */
function* combinations(n: number, k: number, from = 0): Generator<number[]> {
  if (k === 0) {
    yield [];
    return;
  }
  for (let i = from; i <= n - k; i++) {
    for (const rest of combinations(n, k - 1, i + 1)) yield [i, ...rest];
  }
}

/** The board as a player sees it: letters not yet called are HIDDEN. */
export function maskBoard(board: string[], called: string[]): string[] {
  const shown = new Set(called);
  return board.map((row) => [...row].map((ch) => (isLetter(ch) && !shown.has(ch) ? HIDDEN : ch)).join(""));
}

// ── The discus ──────────────────────────────────────────────────────────────

export type Wedge = { kind: "cash"; value: number } | { kind: "bankrupt" } | { kind: "lose" };

// Clockwise from the top. "top" is the round's biggest wedge.
const LAYOUT: Array<number | "top" | "bankrupt" | "lose"> = [
  "top", 600, 500, 700, "bankrupt", 650, 500, 900, 550, 600, "lose", 800,
  500, 650, 700, "bankrupt", 600, 550, 500, 900, 650, 500, 700, 600,
];

export const WEDGE_COUNT = LAYOUT.length;

/** The discus for one round: values rise each round, and the last round's top wedge is $5,000. */
export function wedgesFor(round: number, totalRounds: number): Wedge[] {
  const top = round === totalRounds - 1 ? 5000 : round === 0 ? 2500 : 3500;
  const raise = 100 * Math.min(round, 3);
  return LAYOUT.map((w) =>
    w === "bankrupt" || w === "lose"
      ? { kind: w }
      : { kind: "cash", value: w === "top" ? top : w + raise }
  );
}

export const VOWEL_COST = 250;
/** A round's winner banks at least this much. */
export const MIN_ROUND_WIN = 1000;
export const BONUS_PRIZE = 25000;
export const BONUS_SECONDS = 15;
export const BONUS_GIVEN = ["R", "S", "T", "L", "N", "E"];
export const BONUS_CONSONANTS = 3;
