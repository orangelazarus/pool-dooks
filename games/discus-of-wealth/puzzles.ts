// The puzzle bank. Server-side only — it holds the answers, so nothing under
// components/ or pages/ may import it.
import data from "./puzzles.json";

export interface Puzzle {
  /** Stable: sessions in progress refer to puzzles by id. A hash of the category and puzzle. */
  id: string;
  category: string;
  /** Upper case: letters, spaces and & ' - , . ! ? " : / ; — always fits the board (see board.test.ts). */
  puzzle: string;
  /** "show": aired on Wheel of Fortune · "original": written for this game. */
  source: "show" | "original";
}

export const PUZZLES = data as Puzzle[];
