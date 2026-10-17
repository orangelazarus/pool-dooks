import { describe, expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";
import type { SubterfugeView } from "./schema";

const lie = (id: string) => `NOT REAL ${id} ZQX`;

describe("Subterfuge", () => {
  it("runs a question: lies, picks, scores", async () => {
    const t = createTestSession(plugin, { players: 3, content: { rounds: 5, decoys: false } });
    await t.start();
    for (const id of t.playerIds) await t.as(id).act("lie", { text: lie(id) });
    const view = await t.as("p1").act<SubterfugeView>("state");
    expect(view.phase).toBe("guessing");
    const mine = view.choices!.find((c) => c.mine)!;
    await expect(t.as("p1").act("pick", { choiceId: mine.id })).rejects.toThrow("can't pick your own lie");

    // Everyone falls for p1's lie except p1, who finds the truth.
    const truth = t.state()!.choices.find((c) => c.isTruth)!.id;
    const p1sLie = t.state()!.choices.find((c) => c.authorIds.includes("p1"))!.id;
    await t.as("p1").act("pick", { choiceId: truth });
    await t.as("p2").act("pick", { choiceId: p1sLie });
    await t.as("p3").act("pick", { choiceId: p1sLie });
    expect(t.state()!.phase).toBe("results");
    expect(t.state()!.scores.p1).toBe(1000 + 2 * 500);
  });

  it("keeps who wrote what out of the guessing view", async () => {
    const t = createTestSession(plugin, { players: 2, content: { rounds: 5 }, isPublic: true });
    await t.start();
    for (const id of t.playerIds) await t.as(id).act("lie", { text: lie(id) });
    const watcher = await t.as(null).act<SubterfugeView>("state");
    expect(JSON.stringify(watcher.choices)).not.toMatch(/authorIds|isTruth/);
    expect(watcher.results).toBeNull();
  });

  it("stops waiting for someone who leaves", async () => {
    const t = createTestSession(plugin, { players: 3, content: { rounds: 5 } });
    await t.start();
    await t.as("p1").act("lie", { text: lie("p1") });
    await t.as("p2").act("lie", { text: lie("p2") });
    await t.leave("p3");
    expect(t.state()!.phase).toBe("guessing");
  });

  it("only the host can skip", async () => {
    const t = createTestSession(plugin, { players: 3, content: { rounds: 5 } });
    await t.start();
    await expect(t.as("p2").act("skip", { round: 0, phase: "lying" })).rejects.toThrow("Only the host can do that");
  });
});
