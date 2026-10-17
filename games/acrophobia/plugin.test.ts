import { describe, expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";
import type { AcroContent, AcroView } from "./schema";

type T = ReturnType<typeof createTestSession<AcroContent, import("./schema").AcroState>>;

const content = (over: Partial<AcroContent> = {}): AcroContent => ({ target: 5, faceoffRounds: 1, categories: "winner", ...over });
const fits = (acronym: string) => acronym.split("").map((l) => `${l}x`).join(" ");
const entryOf = (t: T, author: string) => t.state()!.entries.find((e) => e.authorId === author)!.id;

/** Everyone writes; then the votes go as given (voter → author). */
async function playRound(t: T, votes: Record<string, string>) {
  const writers = t.state()!.stage === "faceoff" ? t.state()!.finalists! : t.playerIds;
  for (const id of writers) await t.as(id).act("answer", { text: fits(t.state()!.acronym) });
  for (const [voter, author] of Object.entries(votes)) await t.as(voter).act("vote", { entryId: entryOf(t, author) });
}
const next = (t: T) => t.as(t.hostId).act<AcroView & { finished?: boolean }>("next", { round: t.state()!.round, phase: "results" });

describe("Acrophobia", () => {
  it("plays through to a face-off and a champion", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: content() });
    await t.start();
    await playRound(t, { ann: "bob", bob: "ann", cat: "bob" });
    expect(t.state()!.scores.bob).toBeGreaterThanOrEqual(5);

    await next(t);
    const s = t.state()!;
    expect(s.stage).toBe("faceoff");
    expect(s.finalists).toContain("bob");
    const judge = t.playerIds.find((id) => !s.finalists!.includes(id))!;
    await expect(t.as(judge).act("answer", { text: fits(s.acronym) })).rejects.toThrow("Only the finalists");

    const [first] = s.finalists!;
    await playRound(t, { [judge]: first });
    expect((await next(t)).finished).toBe(true);
    expect(t.status()).toBe("completed");
    expect(((await t.result()) as { champions: string[] }).champions).toEqual([first]);
  });

  it("rejects answers that don't fit the acronym", async () => {
    const t = createTestSession(plugin, { players: 3, content: content() });
    await t.start();
    await expect(t.as("p1").act("answer", { text: "nope" })).rejects.toThrow(/needs \d words/);
  });

  it("lets the round's winner pick the next category, or make one up", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: content({ target: 40 }) });
    await t.start();
    await playRound(t, { ann: "cat", bob: "cat", cat: "ann" });
    await next(t);
    const s = t.state()!;
    expect(s.phase).toBe("choosing");
    expect(s.chooserId).toBe("cat");
    expect(s.offered).toHaveLength(4);
    await expect(t.as("ann").act("choose", { category: "Pirates" })).rejects.toThrow("It's not your pick");
    await t.as("cat").act("choose", { category: "Pirates" });
    expect(t.state()).toMatchObject({ phase: "writing", category: "Pirates" });
  });

  it("lets only the host stop waiting", async () => {
    const t = createTestSession(plugin, { players: 3, content: content() });
    await t.start();
    const step = { round: 0, phase: "writing" };
    await t.as("p1").act("answer", { text: fits(t.state()!.acronym) });
    await expect(t.as("p2").act("skip", step)).rejects.toThrow("Only the host can do that");
    await expect(t.as("p1").act("skip", step)).rejects.toThrow("Wait for at least 2 answers");
    await t.as("p2").act("answer", { text: fits(t.state()!.acronym) });
    await t.as("p1").act("skip", step);
    expect(t.state()!.phase).toBe("voting");
  });

  it("carries on when someone leaves mid-round", async () => {
    const t = createTestSession(plugin, { players: 4, content: content({ target: 40 }) });
    await t.start();
    for (const id of ["p1", "p2", "p3"]) await t.as(id).act("answer", { text: fits(t.state()!.acronym) });
    // p4 was the one everyone was waiting for.
    await t.leave("p4");
    expect(t.state()!.phase).toBe("voting");
  });

  it("hands the face-off to the other finalist when one walks out", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat", "dan"], content: content() });
    await t.start();
    await playRound(t, { ann: "bob", bob: "ann", cat: "bob", dan: "bob" });
    await next(t);
    const [stays, goes] = t.state()!.finalists!;
    await t.leave(goes);
    expect(t.status()).toBe("completed");
    const result = (await t.result()) as { champions: string[]; finalists: Array<{ forfeited: boolean }> };
    expect(result.champions).toEqual([stays]);
    expect(result.finalists.some((f) => f.forfeited)).toBe(true);
  });

  it("ends on the main game when too few are left to judge a face-off", async () => {
    const t = createTestSession(plugin, { players: 3, content: content({ target: 40 }) });
    await t.start();
    await t.leave("p3");
    expect(t.status()).toBe("completed");
  });
});
