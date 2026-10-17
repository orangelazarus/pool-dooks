import { describe, expect, it } from "vitest";
import { defineGame, GameError } from "@/lib/game-sdk";
import { createTestSession } from "@/lib/game-sdk/testing";

interface Turns {
  order: string[];
  turn: number;
}

const Null = () => null;

const base = {
  displayName: "Turns",
  description: "test",
  minPlayers: 2,
  maxPlayers: 4,
  async start(ctx: { state: { init(d: Turns): Promise<unknown> }; session: { players: { id: string }[] } }) {
    await ctx.state.init({ order: ctx.session.players.map((p) => p.id), turn: 0 });
  },
  buildPlayProps: async () => ({}),
  buildResult: async () => ({}),
  PlayComponent: Null,
  RevealComponent: Null,
  BrowsePage: Null,
};

// Carries on without someone: drops them from the order, and ends below two players.
const leavable = defineGame<Record<string, never>, Turns>({
  ...base,
  gameType: "turns_test",
  async onPlayerLeft(ctx, { playerId }) {
    if (playerId === "refuse-me") throw new GameError(409, "Not now");
    const { data } = await ctx.state.mutate((s) => ({ ...s, order: s.order.filter((id) => id !== playerId) }));
    await ctx.broadcast("changed", {});
    if (data.order.length < 2) await ctx.finish();
  },
});

// Has no onPlayerLeft: can't be left once it has started.
const fixed = defineGame<Record<string, never>, Turns>({ ...base, gameType: "fixed_test" });

describe("leaving and removing players", () => {
  it("in the lobby: leave, kick, and the host role passing on", async () => {
    const t = createTestSession(fixed, { players: ["ann", "bob", "cat", "dan"], content: {} });
    await t.leave("bob");
    expect(t.playerIds).toEqual(["ann", "cat", "dan"]);

    await expect(t.kick("cat", "dan")).rejects.toThrow("Only the host can remove players");
    await t.kick("cat");
    expect(t.kicked()).toEqual(["cat"]);

    await t.leave("ann");
    expect(t.hostId).toBe("dan");
    await t.leave("dan");
    expect(t.status()).toBe("expired");
  });

  it("refuses to leave a game in progress that can't go on without them", async () => {
    const t = createTestSession(fixed, { players: 3, content: {} });
    await t.start();
    await expect(t.leave("p2")).rejects.toThrow("can't continue without a player");
    expect(t.playerIds).toEqual(["p1", "p2", "p3"]);
  });

  it("lets the game adjust mid-game, and finishes when it says so", async () => {
    const t = createTestSession(leavable, { players: 3, content: {} });
    await t.start();
    await t.kick("p3");
    expect(t.state()?.order).toEqual(["p1", "p2"]);
    expect(t.status()).toBe("in_progress");
    await t.leave("p1");
    expect(t.hostId).toBe("p2");
    expect(t.status()).toBe("completed");
  });

  it("undoes the removal when the game refuses", async () => {
    const t = createTestSession(leavable, { players: ["ann", "refuse-me", "cat"], content: {} });
    await t.start();
    await expect(t.leave("refuse-me")).rejects.toThrow("Not now");
    expect(t.playerIds).toContain("refuse-me");
    expect(t.state()?.order).toHaveLength(3);
  });

  it("a player who left can no longer act", async () => {
    const t = createTestSession(leavable, { players: 3, content: {} });
    await t.start();
    await t.leave("p2");
    await expect(t.leave("p2")).rejects.toThrow("isn't in this game");
  });
});
