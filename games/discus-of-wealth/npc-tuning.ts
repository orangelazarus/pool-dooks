// How well each level of computer player plays. Change the numbers here to make
// computers stronger or weaker. Every number that changes how well they play is
// here; npc.ts keeps only its timings (how long a computer pauses before moving).
import type { NpcLevel } from "./schema";

export interface NpcTuning {
  // ── Calling letters ──
  /**
   * Luck when it picks a letter. At 0 it always takes the most common letter
   * left (T, N, S…), unless it blunders (see blunderChance). Around 1 a common
   * letter is only somewhat likelier; at 3 or more it's close to random.
   */
  noise: number;
  /** The chance (0–1) that a pick ignores how common letters are and takes any letter left. */
  blunderChance: number;

  // ── Solving ──
  /**
   * It solves once this share (0–1) of the puzzle's letters is showing. This
   * is the main dial: computers always solve correctly, so a lower number
   * means they solve sooner and win more rounds. Keep solveAt + solveJitter
   * at or below 1 (a test checks): above 1, it would sometimes never choose to
   * solve, and play on until every letter is showing.
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
  /**
   * Its chance of solving the bonus puzzle is
   * (share of the board showing − BONUS_START_SHARE) × bonusSkill,
   * kept between bonusMinChance and bonusMaxChance.
   */
  bonusSkill: number;
  /** Its chance of solving the bonus puzzle never goes below this (0–1), however little is showing. */
  bonusMinChance: number;
  /** Its chance of solving the bonus puzzle never goes above this (0–1). Wins over bonusMinChance if they cross. */
  bonusMaxChance: number;
}

/** Below this share of the board showing, bonusSkill adds nothing to its bonus-round chance. */
export const BONUS_START_SHARE = 0.2;

export const NPC_TUNING: Record<NpcLevel, NpcTuning> = {
  easy: {
    noise: 2.5,
    blunderChance: 0.35,
    solveAt: 0.95,
    solveJitter: 0.05,
    vowelChance: 0.1,
    vowelReserve: 500,
    bonusSkill: 0.385,
    bonusMinChance: 0.02,
    bonusMaxChance: 0.35,
  },
  medium: {
    noise: 1.2,
    blunderChance: 0.15,
    solveAt: 0.85,
    solveJitter: 0.08,
    vowelChance: 0.2,
    vowelReserve: 250,
    bonusSkill: 0.66,
    bonusMinChance: 0.02,
    bonusMaxChance: 0.55,
  },
  hard: {
    noise: 0.4,
    blunderChance: 0.05,
    solveAt: 0.72,
    solveJitter: 0.08,
    vowelChance: 0.35,
    vowelReserve: 0,
    bonusSkill: 0.99,
    bonusMinChance: 0.02,
    bonusMaxChance: 0.75,
  },
};
