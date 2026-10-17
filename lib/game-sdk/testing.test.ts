import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineGame, GameError } from "@/lib/game-sdk";
import { createTestSession } from "@/lib/game-sdk/testing";

interface Tally {
  votes: Record<string, string>;
  log: string[];
}

const Null = () => null;

// A tiny game exercising the parts of the SDK the harness has to get right.
const plugin = defineGame<{ topic: string }, Tally>({
  gameType: "tally_test",
  displayName: "Tally",
  description: "test",
  minPlayers: 2,
  maxPlayers: 4,
  async start(ctx) {
    await ctx.state.init({ votes: {}, log: [] });
  },
  async buildPlayProps(ctx) {
    return { viewer: ctx.viewer?.id ?? null, count: Object.keys((await ctx.state.get())!.data.votes).length };
  },
  async buildResult(ctx) {
    return { votes: (await ctx.state.get())!.data.votes };
  },
  sessionActions: {
    vote: {
      access: "player",
      input: z.object({ choice: z.enum(["yes", "no"]) }),
      handler: async (ctx, { choice }: { choice: string }) => {
        const me = ctx.viewer!.id;
        const { data } = await ctx.state.mutate((s) => {
          if (s.votes[me]) throw new GameError(400, "Already voted");
          return { ...s, votes: { ...s.votes, [me]: choice } };
        });
        await ctx.broadcast("voted", { count: Object.keys(data.votes).length });
        if (Object.keys(data.votes).length === ctx.session.players.length) await ctx.finish();
        return data;
      },
    },
    /** Writes, then refuses: the write must stay. */
    noteThenRefuse: {
      access: "player",
      handler: async (ctx) => {
        await ctx.state.mutate((s) => ({ ...s, log: [...s.log, "noted"] }));
        await ctx.broadcast("noted", {});
        throw new GameError(409, "Refused after noting");
      },
    },
    /** Writes, then crashes: nothing may stay. */
    noteThenCrash: {
      access: "player",
      handler: async (ctx) => {
        await ctx.state.mutate((s) => ({ ...s, log: [...s.log, "crashed"] }));
        await ctx.broadcast("crashed", {});
        await ctx.finish();
        throw new Error("boom");
      },
    },
    reset: {
      access: "host",
      handler: async (ctx) => {
        await ctx.state.mutate((s) => ({ ...s, votes: {} }));
      },
    },
    peek: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => ({ role: ctx.role }),
    },
  },
  PlayComponent: Null,
  RevealComponent: Null,
  BrowsePage: Null,
});

const fresh = (options: { isPublic?: boolean } = {}) =>
  createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { topic: "pizza" }, ...options });

async function refusal(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (err) {
    if (err instanceof GameError) return { status: err.status, message: err.message };
    throw err;
  }
  throw new Error("Expected the action to be refused");
}

describe("test harness", () => {
  it("runs actions and records broadcasts", async () => {
    const t = fresh();
    await t.start();
    await t.as("ann").act("vote", { choice: "yes" });
    expect(t.state()?.votes).toEqual({ ann: "yes" });
    expect(t.broadcasts).toEqual([{ name: "voted", data: { count: 1 } }]);
    expect(await t.as("bob").playProps()).toEqual({ viewer: "bob", count: 1 });
  });

  it("finishes the game", async () => {
    const t = fresh();
    await t.start();
    for (const id of t.playerIds) await t.as(id).act("vote", { choice: "no" });
    expect(t.status()).toBe("completed");
    expect(await t.result()).toEqual({ votes: { ann: "no", bob: "no", cat: "no" } });
    // Player actions need a game in progress.
    expect(await refusal(t.as("ann").act("reset"))).toEqual({ status: 400, message: "Session not in progress" });
  });

  it("enforces access levels like the real route", async () => {
    const t = fresh();
    await t.start();
    expect((await refusal(t.as(null).act("vote", { choice: "yes" }))).status).toBe(401);
    expect((await refusal(t.as("stranger").act("vote", { choice: "yes" }))).status).toBe(403);
    expect(await refusal(t.as("bob").act("reset"))).toEqual({ status: 403, message: "Only the host can do that" });
    await t.as("ann").act("reset");
    // A private game hides from outsiders; a public one lets them watch.
    expect((await refusal(t.as("stranger").act("peek"))).status).toBe(403);
    const open = fresh({ isPublic: true });
    await open.start();
    expect(await open.as("stranger").act("peek")).toEqual({ role: "observer" });
  });

  it("validates input", async () => {
    const t = fresh();
    await t.start();
    expect(await refusal(t.as("ann").act("vote", { choice: "maybe" }))).toEqual({ status: 400, message: "Invalid input" });
    expect(t.state()?.votes).toEqual({});
  });

  it("keeps writes made before a GameError, and its broadcasts", async () => {
    const t = fresh();
    await t.start();
    expect((await refusal(t.as("ann").act("noteThenRefuse"))).status).toBe(409);
    expect(t.state()?.log).toEqual(["noted"]);
    expect(t.broadcasts.map((b) => b.name)).toEqual(["noted"]);
  });

  it("rolls back everything when a handler crashes", async () => {
    const t = fresh();
    await t.start();
    await expect(t.as("ann").act("noteThenCrash")).rejects.toThrow("boom");
    expect(t.state()?.log).toEqual([]);
    expect(t.status()).toBe("in_progress");
    expect(t.broadcasts).toEqual([]);
  });

  it("retries mutate when another write lands in between", async () => {
    const t = fresh();
    await t.start();
    let calls = 0;
    const result = await t.withContext("ann", async (ctx) => {
      return ctx.state.mutate((s) => {
        calls++;
        // The first time through, someone else's write gets in first.
        if (calls === 1) t.setState({ ...s, log: ["sneaky"] });
        return { ...s, log: [...s.log, "mine"] };
      });
    });
    expect(calls).toBe(2);
    expect(result.data.log).toEqual(["sneaky", "mine"]);
  });
});
