// Shapes of what Eat Poop You Cat keeps in core's game storage, and of what it
// sends to browsers. Validated here, in code — the game owns no tables.
import { z } from "zod";
import { MAX_DRAWING_CHARS } from "./drawing";

export const STEP_OPTIONS = ["full", 4, 6] as const;
export type StepsSetting = (typeof STEP_OPTIONS)[number];

export const stepsLabel = (steps: StepsSetting) => (steps === "full" ? "full circle" : `${steps} turns`);

/** Content row: the settings the host picked. */
export interface EpycContent {
  /** How many turns each book gets: everyone ("full"), or at most 4 or 6. */
  steps: StepsSetting;
}

export const MIN_TEXT = 2;
export const MAX_TEXT = 100;

export type Entry =
  | { kind: "text"; text: string; by: string }
  | { kind: "drawing"; drawing: string; by: string }
  /** The holder ran out of time, was skipped by the host, or left. */
  | { kind: "skipped"; by: string };

export interface Book {
  id: string;
  ownerId: string;
  /** Who fills each entry, in order: a rotation starting with the owner. */
  holders: string[];
  entries: Entry[];
}

/** Session state. Server-side only: it holds every book. */
export interface EpycState {
  /** async: a book moves on as soon as it's done. live: everyone plays each turn together, on the timer. */
  mode: "async" | "live";
  /** Live mode: the turn everyone is on. */
  round: number;
  books: Book[];
}

export type TaskKind = "start" | "draw" | "describe";

export interface Task {
  bookId: string;
  step: number;
  kind: TaskKind;
  /** draw: the phrase to draw. */
  text?: string;
  /** describe: the drawing to put into words. */
  drawing?: string;
}

/** What one browser is shown. Built per viewer; only ever carries the viewer's own task. */
export interface EpycView {
  mode: EpycState["mode"];
  round: number;
  /** The longest book: how many turns the game has. */
  totalSteps: number;
  task: Task | null;
  /** More books waiting for the viewer after this one. */
  queued: number;
  /** Who holds the viewer's next book, when they're waiting on someone. */
  waitingOn: string | null;
  myDone: number;
  myTotal: number;
  progress: Array<{ playerId: string; done: number; total: number; ready: number }>;
}

export const CreateSchema = z.object({
  steps: z.union([z.literal("full"), z.literal(4), z.literal(6)]),
});

export const SubmitSchema = z.object({
  bookId: z.string().max(10),
  step: z.number().int().min(0).max(20),
  text: z.string().max(400).optional(),
  drawing: z.string().max(MAX_DRAWING_CHARS).optional(),
});

export const SkipSchema = z.object({
  playerId: z.string().max(100),
});
