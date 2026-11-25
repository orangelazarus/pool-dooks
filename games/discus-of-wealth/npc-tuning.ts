// How well each level of computer player plays. Change the numbers here to make
// computers stronger or weaker; npc.ts reads them and has no numbers of its own.
import type { NpcLevel } from "./schema";

export interface NpcTuning {
  // ── Calling letters ──
  /**
   * Luck when it picks a letter. At 0 it always takes the most common letter
   * left (T, N, S…). Around 1 a common letter is only somewhat likelier; at 3
   * or more it's close to random.
   */
  noise: number;
  /** The chance (0–1) that a pick ignores how common letters are and takes any letter left. */
  blunderChance: number;

  // ── Solving ──
  /**
   * It solves once this share (0–1) of the puzzle's letters is showing. This
   * is the main dial: computers always solve correctly, so a lower number
   * means they solve sooner and win more rounds.
   */
  solveAt: number;
  /** Each time it decides, solveAt moves up or down by up to this much, so it isn't predictable. */
  solveJitter: number;

  // ── Buying vowels ──
  /** The chance (0–1) it buys a vowel instead of spinning, when it can afford one. */
  vowelChance: number;
  /** It only chooses to buy a vowel with at least this much round money left over after paying. Once only vowels are left, it buys anyway. */
  vowelReserve: number;

  // ── Bonus round ──
  /** Scales its chance of solving the bonus puzzle, which rises with how much of the board is showing. */
  bonusSkill: number;
  /** Its chance of solving the bonus puzzle never goes above this (0–1). */
  bonusMaxChance: number;
}

export const NPC_TUNING: Record<NpcLevel, NpcTuning> = {
  easy: {
    noise: 2.5,
    blunderChance: 0.35,
    solveAt: 0.95,
    solveJitter: 0.05,
    vowelChance: 0.1,
    vowelReserve: 500,
    bonusSkill: 0.35,
    bonusMaxChance: 0.35,
  },
  medium: {
    noise: 1.2,
    blunderChance: 0.15,
    solveAt: 0.85,
    solveJitter: 0.08,
    vowelChance: 0.2,
    vowelReserve: 250,
    bonusSkill: 0.6,
    bonusMaxChance: 0.55,
  },
  hard: {
    noise: 0.4,
    blunderChance: 0.05,
    solveAt: 0.72,
    solveJitter: 0.08,
    vowelChance: 0.35,
    vowelReserve: 0,
    bonusSkill: 0.9,
    bonusMaxChance: 0.75,
  },
};
