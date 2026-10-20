import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";
import { PUZZLES } from "./puzzles";
import { BONUS_PRIZE, BONUS_SECONDS, WEDGE_COUNT } from "./board";
import type { DiscusContent, DiscusView } from "./schema";

const idOf = (text: string) => PUZZLES.find((p) => p.puzzle === text)!.id;
const PUZZLE = "BETTER LATE THAN NEVER";
const BONUS = "SUBSTITUTE TEACHER";

// Wedges in round 1 (see board.ts): 1 is $600, 4 Bankrupt, 10 Lose a Turn.
const CASH_600 = 1;
const BANKRUPT = 4;
const LOSE = 10;
const landOn = (wedge: number) => vi.spyOn(Math, "random").mockReturnValue((wedge + 0.5) / WEDGE_COUNT);

afterEach(() => vi.restoreAllMocks());

/** A started game whose puzzles are known. */
async function game(content: DiscusContent = { rounds: 3, bonus: true }, options: { timerSeconds?: number; isPublic?: boolean } = {}) {
  const t = createTestSession(plugin, { players: 3, content, ...options });
  await t.start();
  t.setState({ ...t.state()!, puzzleIds: Array(content.rounds).fill(idOf(PUZZLE)), bonusPuzzleId: idOf(BONUS) });
  return t;
}

const view = (t: Awaited<ReturnType<typeof game>>, id: string | null) => t.as(id).act<DiscusView>("state");

describe("Discus of Wealth", () => {
  it("plays a round: spins, letters, Bankrupt, Lose a Turn, solving", async () => {
    const t = await game();
    expect(t.state()!.turnId).toBe("p1");

    landOn(CASH_600);
    await t.as("p1").act("spin");
    await expect(t.as("p1").act("vowel", { letter: "E" })).rejects.toThrow("can't do that right now");
    await t.as("p1").act("consonant", { letter: "T" }); // BETTER, LATE, THAN: four T's
    expect(t.state()!.roundMoney.p1).toBe(2400);
    expect(t.state()!.turnId).toBe("p1");

    await t.as("p1").act("vowel", { letter: "E" });
    expect(t.state()!.roundMoney.p1).toBe(2150);
    await expect(t.as("p1").act("vowel", { letter: "E" })).rejects.toThrow("already been called");

    landOn(BANKRUPT);
    await t.as("p1").act("spin");
    expect(t.state()!.roundMoney.p1).toBe(0);
    expect((await view(t, "p2")).wedge).toBe(BANKRUPT); // the discus shows where it landed
    expect(t.state()!.turnId).toBe("p2");
    await expect(t.as("p1").act("spin")).rejects.toThrow("not your turn");

    landOn(LOSE);
    await t.as("p2").act("spin");
    expect(t.state()!.turnId).toBe("p3");
    expect(t.state()!.wedge).toBe(LOSE);

    landOn(CASH_600);
    await t.as("p3").act("spin");
    await t.as("p3").act("consonant", { letter: "Z" });
    expect(t.state()!.turnId).toBe("p1");

    await t.as("p1").act("solve", { guess: "BETTER LATE THAN EVER" });
    expect(t.state()!.turnId).toBe("p2");
    await t.as("p2").act("solve", { guess: "better late than never!" });
    expect(t.state()!.phase).toBe("solved");
    expect(t.state()!.banks.p2).toBe(1000); // the minimum for a win
    expect(t.currentPlayerId()).toBe("p2");
  });

  it("only offers vowels once the consonants are gone", async () => {
    const t = await game();
    t.setState({ ...t.state()!, called: [..."BTRLHNV"] });
    expect((await view(t, "p1")).canSpin).toBe(false);
    await expect(t.as("p1").act("spin")).rejects.toThrow("Only vowels remain");
  });

  it("never shows the puzzle before it is solved", async () => {
    const t = await game(undefined, { isPublic: true });
    landOn(CASH_600);
    await t.as("p1").act("spin");
    await t.as("p1").act("consonant", { letter: "T" });

    const watcher = await view(t, null);
    expect(JSON.stringify(watcher)).not.toMatch(/BETTER|NEVER|LATE/);
    expect(watcher.board.join("")).toContain("T");
    expect(JSON.stringify(t.broadcasts)).not.toMatch(/BETTER|NEVER/);
    expect(JSON.stringify(await t.as("p2").playProps())).not.toMatch(/BETTER|NEVER/);

    await t.as("p1").act("solve", { guess: PUZZLE });
    expect((await view(t, null)).board.join(" ")).toMatch(/BETTER/);
  });

  it("moves on once however many times Next is tapped", async () => {
    const t = await game();
    await t.as("p1").act("solve", { guess: PUZZLE });
    const { step } = t.state()!;
    await t.as("p2").act("next", { step });
    await t.as("p3").act("next", { step });
    expect(t.state()!.round).toBe(1);
    expect(t.state()!.turnId).toBe("p2"); // the next round opens with the next player
    expect(t.state()!.called).toEqual([]);
  });

  it("ends after the last puzzle when there's no bonus round", async () => {
    const t = await game({ rounds: 3, bonus: false });
    t.setState({ ...t.state()!, round: 2 });
    await t.as("p1").act("solve", { guess: PUZZLE });
    const reply = await t.as("p1").act<{ finished?: boolean }>("next", { step: t.state()!.step });
    expect(reply.finished).toBe(true);
    expect(t.status()).toBe("completed");
  });

  describe("the bonus round", () => {
    async function atBonus() {
      const t = await game();
      t.setState({ ...t.state()!, round: 2, banks: { p1: 3000, p3: 5000 } });
      await t.as("p1").act("solve", { guess: PUZZLE });
      await t.as("p1").act("next", { step: t.state()!.step });
      return t;
    }

    it("goes to the leader, who wins with a solve", async () => {
      const t = await atBonus();
      expect(t.state()!.phase).toBe("bonusPick");
      expect(t.state()!.turnId).toBe("p3"); // 5000 beats p1's 3000 + 1000
      await expect(t.as("p3").act("bonusPick", { consonants: ["R", "C", "D"], vowel: "A" })).rejects.toThrow("already showing");
      await expect(t.as("p1").act("bonusPick", { consonants: ["B", "C", "D"], vowel: "A" })).rejects.toThrow("not your turn");
      await t.as("p3").act("bonusPick", { consonants: ["B", "C", "H"], vowel: "U" });
      expect(t.deadline()?.key).toBe("bonus");

      await t.as("p3").act("bonusSolve", { guess: "SUBSTITUTE PREACHER" });
      expect(t.status()).toBe("in_progress");
      await t.as("p3").act("bonusSolve", { guess: BONUS });
      expect(t.status()).toBe("completed");
      expect(t.state()!.banks.p3).toBe(5000 + BONUS_PRIZE);

      const result = (await t.result()) as { bonus: { won: boolean; puzzle: string } };
      expect(result.bonus).toMatchObject({ won: true, puzzle: BONUS });
    });

    it("is lost when the clock runs out", async () => {
      const t = await atBonus();
      await t.as("p3").act("bonusPick", { consonants: ["B", "C", "H"], vowel: "U" });
      await t.clock.advance(BONUS_SECONDS * 1000);
      expect(t.status()).toBe("completed");
      expect(t.state()!.bonus!.won).toBe(false);
      expect(t.state()!.banks.p3).toBe(5000);
    });
  });

  it("passes the turn when the turn timer runs out", async () => {
    const t = await game(undefined, { timerSeconds: 15 });
    await t.clock.advance(15000);
    expect(t.state()!.turnId).toBe("p2");
    expect(t.state()!.last?.kind).toBe("timeout");

    // Each move earns fresh time.
    landOn(CASH_600);
    await t.clock.advance(10000);
    await t.as("p2").act("spin");
    await t.clock.advance(10000);
    expect(t.state()!.turnId).toBe("p2");
    await t.clock.advance(5000);
    expect(t.state()!.turnId).toBe("p3");
  });

  it("lets only the host skip a stalled player", async () => {
    const t = await game();
    const { step } = t.state()!;
    await expect(t.as("p2").act("skip", { step })).rejects.toThrow("Only the host can do that");
    await t.as("p1").act("skip", { step });
    expect(t.state()!.turnId).toBe("p2");
  });

  it("carries on without a player who leaves on their turn", async () => {
    const t = await game();
    await t.leave("p1");
    expect(t.state()!.turnId).toBe("p2");
    expect(t.state()!.order).toEqual(["p2", "p3"]);
    await t.leave("p3");
    expect(t.status()).toBe("completed");
  });
});

