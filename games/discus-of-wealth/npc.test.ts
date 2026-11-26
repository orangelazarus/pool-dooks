import { describe, expect, it } from "vitest";
import { GameError } from "@/lib/game-sdk";
import { BONUS_GIVEN, CONSONANTS, VOWELS, WEDGE_COUNT } from "./board";
import { chooseLetter, isNpc, makeNpcs, npcDelay, npcTurn, seeded, shownShare } from "./npc";
import { freshState, pickPuzzles, startBonus } from "./rules";
import { NPC_TUNING } from "./npc-tuning";
import { PUZZLES } from "./puzzles";
import { NPC_LEVELS, type DiscusState } from "./schema";

const idOf = (text: string) => PUZZLES.find((p) => p.puzzle === text)!.id;

/** A game of three computers on a known puzzle. */
function npcGame(puzzle = "BETTER LATE THAN NEVER"): DiscusState {
  const npcs = makeNpcs(3, seeded(1));
  const state = freshState(Object.keys(npcs), { puzzleIds: [idOf(puzzle)], bonusPuzzleId: idOf("SUBSTITUTE TEACHER") });
  return { ...state, npcs };
}

describe("computer players", () => {
  it("names distinct npcs", () => {
    const npcs = makeNpcs(2, seeded(0.3));
    expect(Object.keys(npcs)).toEqual(["npc:1", "npc:2"]);
    expect(new Set(Object.values(npcs)).size).toBe(2);
    expect(isNpc({ ...npcGame(), npcs }, "npc:1")).toBe(true);
    expect(isNpc({ ...npcGame(), npcs }, "p1")).toBe(false);
  });

  it("never picks an excluded letter, and null once none are left", () => {
    const rng = seeded(0.42);
    for (let i = 0; i < 500; i++) {
      const exclude = CONSONANTS.filter(() => rng() < 0.5);
      const letter = chooseLetter("consonant", exclude, "easy", rng);
      if (exclude.length === CONSONANTS.length) expect(letter).toBeNull();
      else expect(exclude).not.toContain(letter);
    }
    expect(chooseLetter("vowel", VOWELS, "hard", rng)).toBeNull();
  });

  it("plays the common letters first, more surely the harder it is", () => {
    const share = (level: (typeof NPC_LEVELS)[number]) => {
      const rng = seeded(0.7);
      let common = 0;
      for (let i = 0; i < 1000; i++) if ("TNS".includes(chooseLetter("consonant", [], level, rng)!)) common++;
      return common / 1000;
    };
    expect(share("hard")).toBeGreaterThan(0.75); // about 0.87 with today's tuning
    expect(share("hard")).toBeGreaterThan(share("medium"));
    expect(share("medium")).toBeGreaterThan(share("easy"));
    expect(share("easy")).toBeGreaterThan(3 / 21); // still better than chance
  });

  it("keeps every level's solving threshold reachable", () => {
    for (const level of NPC_LEVELS) {
      const { solveAt, solveJitter } = NPC_TUNING[level];
      expect(solveAt + solveJitter, level).toBeLessThanOrEqual(1);
    }
  });

  it("buys a vowel that's there once only vowels are hidden", () => {
    const rng = seeded(0.9);
    for (let i = 0; i < 100; i++) expect(chooseLetter("vowel", [], "easy", rng, ["U"])).toBe("U");
  });

  it("solves once all the consonants are up and it can't buy a vowel", () => {
    const state = { ...npcGame(), called: [..."BTRLHNV"] };
    const next = npcTurn(state, "easy", seeded(0.5), 0);
    expect(next.phase).toBe("solved");
  });

  it("only ever makes moves the rules allow, and finishes the round", () => {
    for (const level of NPC_LEVELS) {
      for (let game = 0; game < 30; game++) {
        const rng = seeded(game / 30 + 0.001);
        const { puzzleIds } = pickPuzzles(1);
        let state: DiscusState = { ...npcGame(), puzzleIds };
        for (let move = 0; move < 300 && state.phase !== "solved"; move++) {
          expect(npcDelay(state, level, rng)).not.toBeNull();
          try {
            state = npcTurn(state, level, rng, Math.floor(rng() * WEDGE_COUNT));
          } catch (err) {
            throw new Error(`${level} made a refused move: ${(err as GameError).message} (${JSON.stringify(state)})`);
          }
        }
        expect(state.phase).toBe("solved");
      }
    }
  });

  it("picks legal bonus letters", () => {
    for (let i = 0; i < 50; i++) {
      const state = startBonus({ ...npcGame(), phase: "solved" });
      const next = npcTurn(state, "medium", seeded(i / 50), 0);
      expect(next.phase).toBe("bonusSolve");
      expect(next.bonus!.picks).toHaveLength(4);
      expect(next.bonus!.picks.some((l) => BONUS_GIVEN.includes(l))).toBe(false);
      expect(shownShare(next)).toBeGreaterThan(0);
    }
  });

  it("waits for the discus to stop before calling a letter", () => {
    const state: DiscusState = { ...npcGame(), phase: "call", wedge: 1 };
    expect(npcDelay(state, "medium", seeded(0.5))).toBeGreaterThan(3950);
    expect(npcDelay({ ...state, turnId: "p1" }, "medium", seeded(0.5))).toBeNull();
  });
});
