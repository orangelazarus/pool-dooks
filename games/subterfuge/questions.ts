// The question bank. Server-side only — it holds the answers, so nothing under
// components/ or pages/ may import it.
import data from "./questions.json";

export interface Question {
  /** Stable: sessions in progress refer to questions by id. A hash of the prompt. */
  id: string;
  /** Which edition of Fibbage the question came from. */
  source: "Fibbage" | "Fibbage 2" | "Fibbage 3";
  /** The blank is written as five underscores. A final-round prompt is a clue with no blank. */
  prompt: string;
  answer: string;
  /** Other wordings of the answer that a "lie" must not match. */
  alternates?: string[];
  /** Ready-made lies, used as decoys when there are few players. Not every source has them. */
  suggestions?: string[];
  /** Written for the last, double-points question. */
  final?: boolean;
}

export const QUESTIONS = data as Question[];
