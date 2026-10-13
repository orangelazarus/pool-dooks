// Shapes of what Subterfuge keeps in core's game storage, and of what it sends
// to browsers. Validated here, in code — Subterfuge owns no database tables.
import { z } from "zod";

export const ROUND_OPTIONS = [5, 8, 10] as const;

/** Content row: the settings the host picked at creation time. */
export interface SubterfugeContent {
  rounds: number;
  /** Pad a short list of choices with ready-made lies. Missing on older rows, which had them on. */
  decoys?: boolean;
}

// lying — everyone writes a lie · guessing — everyone picks · results — the truth is out
export type Phase = "lying" | "guessing" | "results";

export interface Choice {
  id: string;
  text: string;
  /** Who wrote this lie; several when players wrote the same one. Empty for the truth and for decoys. */
  authorIds: string[];
  isTruth: boolean;
}

/** One finished question, kept for the results screen and the reveal. */
export interface RoundRecord {
  questionId: string;
  choices: Choice[];
  /** playerId → the choice they picked. */
  picks: Record<string, string>;
  /** playerId → points won this question. */
  gained: Record<string, number>;
}

/** Session state. Server-side only: it holds the answers and who wrote what. */
export interface SubterfugeState {
  questionIds: string[];
  round: number;
  phase: Phase;
  /** playerId → their lie for the current question. */
  lies: Record<string, string>;
  /** Built once, shuffled, when guessing opens. */
  choices: Choice[];
  picks: Record<string, string>;
  scores: Record<string, number>;
  history: RoundRecord[];
}

/** What one browser is shown. Built per viewer; never carries a secret before the results phase. */
export interface SubterfugeView {
  round: number;
  totalRounds: number;
  phase: Phase;
  prompt: string;
  /** Points multiplier for this question. */
  multiplier: number;
  /** Who has acted in the current phase. */
  actedIds: string[];
  scores: Record<string, number>;
  myLie: string | null;
  myPick: string | null;
  /** Guessing phase only. */
  choices: Array<{ id: string; text: string; mine: boolean }> | null;
  /** Results phase only. */
  results: {
    answer: string;
    choices: Array<{ id: string; text: string; isTruth: boolean; authorIds: string[]; pickerIds: string[] }>;
    gained: Record<string, number>;
  } | null;
}

/** The realtime nudge: enough to know something changed, nothing worth peeking at. */
export interface ChangedPayload {
  round: number;
  phase: Phase;
  actedIds: string[];
}

export const CreateSchema = z.object({
  rounds: z.union([z.literal(5), z.literal(8), z.literal(10)]),
  decoys: z.boolean().default(true),
});

export const LieSchema = z.object({
  text: z.string().trim().min(1).max(60),
});

export const PickSchema = z.object({
  choiceId: z.string().min(1).max(8),
});

/** Names the step the client is looking at, so a double tap can't advance twice. */
export const StepSchema = z.object({
  round: z.number().int().min(0),
  phase: z.enum(["lying", "guessing", "results"]),
});
