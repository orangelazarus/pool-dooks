// Shapes of what Acrophobia keeps in core's game storage, and of what it sends
// to browsers. Validated here, in code — Acrophobia owns no database tables.
import { z } from "zod";

export const TARGET_OPTIONS = [15, 20, 30, 40] as const;
export const FACEOFF_OPTIONS = [1, 3, 5] as const;
export const CATEGORY_MODES = ["off", "random", "winner"] as const;
export type CategoryMode = (typeof CATEGORY_MODES)[number];

export const CATEGORY_MODE_LABELS: Record<CategoryMode, string> = {
  off: "No categories",
  random: "A random category each round",
  winner: "Last round's winner picks",
};

/** Content row: the settings the host picked at creation time. */
export interface AcroContent {
  /** The score that sends the top two to the face-off. */
  target: number;
  faceoffRounds: number;
  categories: CategoryMode;
}

// choosing — the last winner picks a category · writing — everyone writes a backronym
// voting — everyone picks a favourite · results — who wrote what is out
export type Phase = "choosing" | "writing" | "voting" | "results";
export type Stage = "main" | "faceoff";

export interface Answer {
  text: string;
  /** Milliseconds from writing opening to this answer arriving. */
  at: number;
}

export interface Entry {
  id: string;
  authorId: string;
  text: string;
  at: number;
}

/** One finished round, kept for the results screen and the reveal. */
export interface RoundRecord {
  stage: Stage;
  acronym: string;
  category: string | null;
  entries: Entry[];
  /** voterId → the entry they voted for. */
  votes: Record<string, string>;
  /** The winning entry, or null when nobody voted. */
  winnerEntryId: string | null;
  /** The fastest entry that got a vote (main stage only). */
  fastestEntryId: string | null;
  /** playerId → points won this round. */
  gained: Record<string, number>;
}

/** Session state. Server-side only: it holds who wrote what. */
export interface AcroState {
  stage: Stage;
  /** Counts every round played, across both stages. */
  round: number;
  /** Counts rounds within the current stage. */
  stageRound: number;
  phase: Phase;
  acronym: string;
  category: string | null;
  /** The categories the chooser may pick from. */
  offered: string[];
  chooserId: string | null;
  /** When writing opened (ms since epoch), for the speed bonus. */
  openedAt: number;
  answers: Record<string, Answer>;
  /** Built once, shuffled, when voting opens. */
  entries: Entry[];
  votes: Record<string, string>;
  scores: Record<string, number>;
  /** playerId → main-stage rounds won, the face-off tie-break. */
  wins: Record<string, number>;
  finalists: string[] | null;
  faceoffScores: Record<string, number>;
  history: RoundRecord[];
}

/** What one browser is shown. Built per viewer; never carries a secret before the results phase. */
export interface AcroView {
  round: number;
  stage: Stage;
  stageRound: number;
  faceoffRounds: number;
  target: number;
  phase: Phase;
  acronym: string;
  category: string | null;
  offered: string[];
  chooserId: string | null;
  finalists: string[] | null;
  /** Who is expected to act in the current phase. */
  expectedIds: string[];
  /** Who has acted in the current phase. */
  actedIds: string[];
  scores: Record<string, number>;
  faceoffScores: Record<string, number>;
  myAnswer: string | null;
  myVote: string | null;
  /** Voting phase only. */
  entries: Array<{ id: string; text: string; mine: boolean }> | null;
  /** Results phase only. */
  results: {
    entries: Array<{ id: string; text: string; authorId: string; at: number; voterIds: string[] }>;
    winnerEntryId: string | null;
    fastestEntryId: string | null;
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
  target: z.union([z.literal(15), z.literal(20), z.literal(30), z.literal(40)]),
  faceoffRounds: z.union([z.literal(1), z.literal(3), z.literal(5)]),
  categories: z.enum(CATEGORY_MODES),
});

export const AnswerSchema = z.object({
  text: z.string().trim().min(1).max(150),
});

export const VoteSchema = z.object({
  entryId: z.string().min(1).max(8),
});

export const ChooseSchema = z.object({
  category: z.string().trim().min(1).max(40),
});

/** Names the step the client is looking at, so a double tap can't advance twice. */
export const StepSchema = z.object({
  round: z.number().int().min(0),
  phase: z.enum(["choosing", "writing", "voting", "results"]),
});
