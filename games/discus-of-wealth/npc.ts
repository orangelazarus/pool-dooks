// Computer players. Plain rules and dice, no AI. Server-side only: they read
// the puzzle (through rules.ts) to know how much of it is showing, and to
// solve it once they decide to.
import { BONUS_CONSONANTS, BONUS_GIVEN, SPIN_MS, VOWEL_COST, CONSONANTS, VOWELS } from "./board";
import {
  bonusPick,
  bonusSolve,
  buyVowel,
  callConsonant,
  currentPuzzle,
  lettersOf,
  remaining,
  solve,
  spin,
} from "./rules";
import type { DiscusState, NpcLevel } from "./schema";
import { NPC_TUNING } from "./npc-tuning";

/** Names for computer players, picked at random. */
const NAMES = ["Dusty", "Penny", "Lucky", "Goldie", "Sparky", "Bingo", "Nickel", "Ruby", "Jackpot", "Dot"];

// English letters, most common first.
const CONSONANT_ORDER = "TNSRHLDCMFPGWYBVKXJQZ".split("");
const VOWEL_ORDER = "EAOIU".split("");

export type Rng = () => number;

/** A small seeded generator, so a retried write makes the same choices. */
export function seeded(seed: number): Rng {
  let a = Math.floor(seed * 2 ** 32) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32;
  };
}

/** Names `count` computer players: ids npc:1, npc:2… */
export function makeNpcs(count: number, rng: Rng = Math.random): Record<string, string> {
  const names = [...NAMES];
  const npcs: Record<string, string> = {};
  for (let i = 1; i <= count; i++) npcs[`npc:${i}`] = names.splice(Math.floor(rng() * names.length), 1)[0];
  return npcs;
}

export const isNpc = (state: DiscusState, id: string) => Object.hasOwn(state.npcs ?? {}, id);

/**
 * Picks a letter: the more common it is, the likelier, with `noise` for luck,
 * and now and then (`blunderChance`) any letter at all.
 * Letters in `boost` win outright. From the original PHP chooseCpuLetter; the
 * port checks the boost against the letter itself (the PHP checked the letter
 * at the same index of the full list, which no longer lined up once called
 * letters were taken out). Null if every letter is excluded.
 */
export function chooseLetter(
  kind: "consonant" | "vowel",
  exclude: string[],
  level: NpcLevel,
  rng: Rng,
  boost: string[] = []
): string | null {
  const left = (kind === "consonant" ? CONSONANT_ORDER : VOWEL_ORDER).filter((l) => !exclude.includes(l));
  const n = left.length;
  const { noise, blunderChance } = NPC_TUNING[level];
  const blunder = rng() < blunderChance;
  let best: string | null = null;
  let bestWeight = -Infinity;
  left.forEach((letter, i) => {
    const odds = blunder ? n * rng() : n - i + noise * n * rng();
    const weight = odds + (boost.includes(letter) ? 1000 * n : 0);
    if (weight > bestWeight) {
      best = letter;
      bestWeight = weight;
    }
  });
  return best;
}

/** The share of the puzzle's letter tiles that are showing. */
export function shownShare(state: DiscusState): number {
  const letters = lettersOf(currentPuzzle(state).puzzle);
  if (letters.length === 0) return 1;
  return [...letters].filter((l) => state.called.includes(l)).length / letters.length;
}

/** Whether the computer playing the bonus round will solve it. Decided once its letters are up. */
export function bonusWins(state: DiscusState, level: NpcLevel, rng: Rng): boolean {
  const { bonusSkill, bonusMaxChance } = NPC_TUNING[level];
  const chance = Math.min(bonusMaxChance, Math.max(0.02, (shownShare(state) - 0.2) * 1.1 * bonusSkill));
  return rng() < chance;
}

/**
 * How long to wait before the computer whose turn it is moves; null if it
 * isn't a computer's move. Slow enough for people to follow along.
 */
export function npcDelay(state: DiscusState, level: NpcLevel, rng: Rng): number | null {
  if (!isNpc(state, state.turnId)) return null;
  const pause = 1200 + rng() * 800;
  switch (state.phase) {
    case "call":
      return SPIN_MS + pause; // Let the discus stop first.
    case "turn": {
      // The last player's spin (Bankrupt, Lose a Turn) is still turning.
      const spun = state.last?.kind === "bankrupt" || state.last?.kind === "lose";
      return (spun ? SPIN_MS : 0) + pause;
    }
    case "bonusPick":
      return 2500 + pause;
    case "bonusSolve":
      return bonusWins(state, level, rng) ? 3000 + rng() * 6000 : null;
    default:
      return null;
  }
}

/**
 * The computer whose turn it is makes one move. `wedge` is where a spin lands,
 * chosen by the caller. Pure: run it again with the same rng and it does the same.
 */
export function npcTurn(state: DiscusState, level: NpcLevel, rng: Rng, wedge: number): DiscusState {
  const id = state.turnId;
  const tuning = NPC_TUNING[level];
  const answer = currentPuzzle(state).puzzle;

  switch (state.phase) {
    case "call": {
      const letter = chooseLetter("consonant", state.called, level, rng);
      return letter ? callConsonant(state, id, letter) : solve(state, id, answer);
    }

    case "turn": {
      const consonantsLeft = remaining(state, CONSONANTS).length > 0;
      const vowelsLeft = remaining(state, VOWELS);
      const money = state.roundMoney[id] ?? 0;
      const canBuy = money >= VOWEL_COST && vowelsLeft.length > 0;
      const stuck = !consonantsLeft && !canBuy;
      const solveAt = tuning.solveAt + (rng() * 2 - 1) * tuning.solveJitter;
      if (stuck || shownShare(state) >= solveAt) return solve(state, id, answer);
      const wantsVowel = money - VOWEL_COST >= tuning.vowelReserve && rng() < tuning.vowelChance;
      if (canBuy && (!consonantsLeft || wantsVowel)) {
        // Once only vowels are hidden, it buys one that's there: the PHP's onlyVowelsRemain.
        const letter = chooseLetter("vowel", state.called, level, rng, consonantsLeft ? [] : vowelsLeft)!;
        return buyVowel(state, id, letter);
      }
      return spin(state, id, wedge);
    }

    case "bonusPick": {
      const consonants: string[] = [];
      for (let i = 0; i < BONUS_CONSONANTS; i++) {
        consonants.push(chooseLetter("consonant", [...BONUS_GIVEN, ...consonants], level, rng)!);
      }
      return bonusPick(state, id, consonants, chooseLetter("vowel", BONUS_GIVEN, level, rng)!);
    }

    case "bonusSolve":
      return bonusSolve(state, id, answer);

    default:
      return state;
  }
}
