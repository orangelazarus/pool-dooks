// Shapes of what Discus of Wealth keeps in core's game storage, and of what it
// sends to browsers. Validated here, in code — the game owns no database tables.
import { z } from "zod";
import { BONUS_CONSONANTS, type Wedge } from "./board";

export const ROUND_OPTIONS = [3, 4, 5] as const;

/** Content row: the settings the host picked at creation time. */
export interface DiscusContent {
  rounds: number;
  /** End with a bonus round for the leader. */
  bonus: boolean;
}

// turn — spin, buy a vowel or solve · call — spun a value, now call a consonant
// solved — the round's answer is up · bonusPick / bonusSolve — the bonus round
// over — the game has ended
export type Phase = "turn" | "call" | "solved" | "bonusPick" | "bonusSolve" | "over";

/** The last thing that happened, for the line under the board. */
export interface Happening {
  kind: "spin" | "bankrupt" | "lose" | "letter" | "wrong" | "solved" | "timeout" | "skipped" | "bonus";
  playerId: string;
  wedge?: number;
  letter?: string;
  /** How many of `letter` are in the puzzle. */
  count?: number;
  /** Money won (letter, solved) or paid (vowel, as a negative). */
  amount?: number;
  guess?: string;
}

/** One finished main round. */
export interface RoundRecord {
  puzzleId: string;
  /** Null if nobody solved it (everyone left). */
  winnerId: string | null;
  won: number;
}

export interface BonusRecord {
  playerId: string;
  /** The letters they chose. */
  picks: string[];
  guesses: string[];
  /** Null while it's being played. */
  won: boolean | null;
}

/** Session state. Server-side only: it names the puzzles. */
export interface DiscusState {
  puzzleIds: string[];
  bonusPuzzleId: string | null;
  /** Turn order: player ids. Shrinks as players leave. */
  order: string[];
  round: number;
  phase: Phase;
  /** Moves on with every change, so a double-tapped button can't act twice. */
  step: number;
  turnId: string;
  /** Letters called this round, in order — hits and misses. */
  called: string[];
  /** Where the last spin landed (the discus keeps showing it); the value being played for while calling. */
  wedge: number | null;
  /** Spins so far, so every browser animates each one even when it lands where the last did. */
  spins: number;
  roundMoney: Record<string, number>;
  banks: Record<string, number>;
  last: Happening | null;
  history: RoundRecord[];
  bonus: BonusRecord | null;
}

/** What one browser is shown. Never names a puzzle before it is solved or the game is over. */
export interface DiscusView {
  round: number;
  totalRounds: number;
  phase: Phase;
  step: number;
  category: string;
  /** Four rows of 14 cells: " " no tile, "_" a hidden letter, anything else shows. */
  board: string[];
  called: string[];
  order: string[];
  turnId: string;
  wedges: Wedge[];
  wedge: number | null;
  spins: number;
  roundMoney: Record<string, number>;
  banks: Record<string, number>;
  last: Happening | null;
  canSpin: boolean;
  canBuy: boolean;
  /** The bonus round, once it has begun. */
  bonus: (BonusRecord & { prize: number }) | null;
}

/** The realtime nudge: enough to know something changed, nothing worth peeking at. */
export interface ChangedPayload {
  step: number;
  phase: Phase;
  turnId: string;
}

export const CreateSchema = z.object({
  rounds: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  bonus: z.boolean().default(true),
});

const letter = z.string().regex(/^[A-Z]$/);

export const LetterSchema = z.object({ letter });

export const SolveSchema = z.object({
  guess: z.string().trim().min(1).max(80),
});

export const BonusPickSchema = z.object({
  consonants: z.array(letter).length(BONUS_CONSONANTS),
  vowel: letter,
});

/** Names the step the client is looking at, so a double tap can't advance twice. */
export const StepSchema = z.object({
  step: z.number().int().min(0),
});
