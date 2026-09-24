// Pure scoring engine, shared by the server (plugin.ts route handlers) and the
// client (FarkleBoard's live selection preview). No DB/React imports here.

export type Ruleset = "original" | "kcd";

export interface ScoreGroup {
  kind: "single" | "n-of-a-kind" | "straight" | "three-pairs";
  face?: number;
  count?: number;
  dice: number[];
  points: number;
  label: string;
}

export interface ScoreResult {
  valid: boolean;
  points: number;
  groups: ScoreGroup[];
}

export interface RulesetMeta {
  id: Ruleset;
  label: string;
  minEntryScore: number;
  bullets: string[];
}

export const RULESETS: Record<Ruleset, RulesetMeta> = {
  kcd: {
    id: "kcd",
    label: "KCD (Tavern Dice)",
    minEntryScore: 0,
    bullets: [
      "Three of a kind = face × 200 (three 1s = 1000)",
      "4/5/6-of-a-kind doubles per extra die (×2, ×4, ×8)",
      "No straight or three-pairs bonus",
      "Bank any amount, even on your very first turn",
    ],
  },
  original: {
    id: "original",
    label: "Original (Standard)",
    minEntryScore: 500,
    bullets: [
      "Three of a kind = face × 100 (three 1s = 1000)",
      "4/5/6-of-a-kind are flat bonuses: 1000 / 2000 / 3000",
      "Straight (1-6) = 2500, three pairs = 1500",
      "Need 500+ points in a turn before your first bank",
    ],
  },
};

export function getRulesetMeta(ruleset: Ruleset): RulesetMeta {
  return RULESETS[ruleset];
}

function tally(dice: number[]): Map<number, number> {
  const t = new Map<number, number>();
  for (const d of dice) t.set(d, (t.get(d) ?? 0) + 1);
  return t;
}

function isStraight(dice: number[]): boolean {
  if (dice.length !== 6) return false;
  const unique = new Set(dice);
  return unique.size === 6 && [1, 2, 3, 4, 5, 6].every((f) => unique.has(f));
}

function isThreePairs(dice: number[]): boolean {
  if (dice.length !== 6) return false;
  const t = tally(dice);
  const counts = [...t.values()];
  return t.size === 3 && counts.every((c) => c === 2);
}

function nOfAKindPoints(face: number, count: number, ruleset: Ruleset): number {
  const base3 = face === 1 ? 1000 : ruleset === "kcd" ? face * 200 : face * 100;
  if (count === 3) return base3;
  if (ruleset === "kcd") {
    return base3 * 2 ** (count - 3);
  }
  return { 4: 1000, 5: 2000, 6: 3000 }[count as 4 | 5 | 6] ?? 0;
}

/** Score an arbitrary subset of dice a player wants to set aside from a roll. */
export function scoreSelection(dice: number[], ruleset: Ruleset): ScoreResult {
  if (dice.length === 0) return { valid: false, points: 0, groups: [] };

  if (ruleset === "original") {
    if (isStraight(dice)) {
      return {
        valid: true,
        points: 2500,
        groups: [{ kind: "straight", dice: [...dice], points: 2500, label: "Straight" }],
      };
    }
    if (isThreePairs(dice)) {
      return {
        valid: true,
        points: 1500,
        groups: [{ kind: "three-pairs", dice: [...dice], points: 1500, label: "Three pairs" }],
      };
    }
  }

  const t = tally(dice);
  const groups: ScoreGroup[] = [];
  let valid = true;

  for (const [face, count] of t) {
    if (count >= 3) {
      const points = nOfAKindPoints(face, count, ruleset);
      groups.push({
        kind: "n-of-a-kind",
        face,
        count,
        dice: Array(count).fill(face),
        points,
        label: `${count === 3 ? "Three" : count === 4 ? "Four" : count === 5 ? "Five" : "Six"} ${face}s`,
      });
      continue;
    }
    if (face === 1) {
      groups.push({
        kind: "single",
        face,
        dice: Array(count).fill(1),
        points: count * 100,
        label: count === 1 ? "Single 1" : `${count} × 1`,
      });
      continue;
    }
    if (face === 5) {
      groups.push({
        kind: "single",
        face,
        dice: Array(count).fill(5),
        points: count * 50,
        label: count === 1 ? "Single 5" : `${count} × 5`,
      });
      continue;
    }
    // A lone or paired 2/3/4/6 never scores — the whole selection is invalid.
    valid = false;
  }

  const points = valid ? groups.reduce((sum, g) => sum + g.points, 0) : 0;
  return { valid, points, groups: valid ? groups : [] };
}

/** Does this freshly-rolled set of dice contain ANY legal scoring subset at all? */
export function hasAnyScoringSubset(dice: number[], ruleset: Ruleset): boolean {
  if (ruleset === "original" && (isStraight(dice) || isThreePairs(dice))) return true;
  const t = tally(dice);
  if ((t.get(1) ?? 0) > 0) return true;
  if ((t.get(5) ?? 0) > 0) return true;
  for (const face of [2, 3, 4, 6]) {
    if ((t.get(face) ?? 0) >= 3) return true;
  }
  return false;
}
