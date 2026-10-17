import { describe, expect, it } from "vitest";
import { defineGame } from "@/lib/game-sdk";
import { createTestSession } from "@/lib/game-sdk/testing";

interface Race {
  phase: "writing" | "voting" | "done";
  answered: string[];
  timeouts: number;
}

const Null = () => null;

// Writing closes when everyone has answered, or when the clock runs out.
const plugin = defineGame<Record<string, never>, Race>({
  gameType: "race_test",
  displayName: "Race",
  description: "test",
  minPlayers: 2,
  maxPlayers: 4,
  timer: { options: [30, 60], label: "Time to answer" },
  async start(ctx) {
    await ctx.state.init({ phase: "writing", answered: [], timeouts: 0 });
    if (ctx.session.timerSeconds) await ctx.deadline.set(ctx.session.timerSeconds * 1000, "writing");
  },
  async onDeadline(ctx, key) {
    if (key !== "writing") return;
    await ctx.state.mutate((s) => ({ ...s, phase: "voting", timeouts: s.timeouts + 1 }));
    await ctx.broadcast("changed", {});
  },
  async buildPlayProps(ctx) {
    return { phase: (await ctx.state.get())!.data.phase };
  },
  async buildResult() {
    return {};
  },
  sessionActions: {
    answer: {
      access: "player",
      handler: async (ctx) => {
        const me = ctx.viewer!.id;
        const { data } = await ctx.state.mutate((s) => {
          const answered = s.answered.includes(me) ? s.answered : [...s.answered, me];
          const done = answered.length === ctx.session.players.length;
          return { ...s, answered, phase: done ? "voting" : s.phase };
        });
        if (data.phase === "voting") await ctx.deadline.clear();
        return data;
      },
    },
  },
  PlayComponent: Null,
  RevealComponent: Null,
  BrowsePage: Null,
});

const fresh = (timerSeconds: number | null = 30) =>
  createTestSession(plugin, { players: 3, content: {}, timerSeconds });

describe("deadlines", () => {
  it("fires once when the clock runs out", async () => {
    const t = fresh();
    await t.start();
    expect(t.deadline()?.key).toBe("writing");

    expect(await t.clock.advance(29_000)).toBe(false);
    expect(t.state()?.phase).toBe("writing");

    expect(await t.clock.advance(1_000)).toBe(true);
    expect(t.state()).toMatchObject({ phase: "voting", timeouts: 1 });
    expect(t.deadline()).toBeNull();

    // Already claimed: a second nudge, or a later action, fires nothing.
    expect(await t.clock.advance(60_000)).toBe(false);
    await t.as("p1").act("answer");
    expect(t.state()?.timeouts).toBe(1);
  });

  it("is settled by the next page load when no browser was watching", async () => {
    const t = fresh();
    await t.start();
    await t.clock.advance(31_000, { nudge: false });
    expect(t.state()?.phase).toBe("writing");
    expect(await t.as("p2").playProps()).toEqual({ phase: "voting" });
    expect(t.state()?.timeouts).toBe(1);
  });

  it("is settled before a late action runs", async () => {
    const t = fresh();
    await t.start();
    await t.clock.advance(31_000, { nudge: false });
    const reply = await t.as("p1").act<Race>("answer");
    // Writing had already closed when the answer arrived; the game sees that.
    expect(reply).toMatchObject({ phase: "voting", timeouts: 1 });
  });

  it("announces set and clear to browsers", async () => {
    const t = fresh();
    await t.start();
    for (const id of t.playerIds) await t.as(id).act("answer");
    expect(t.state()?.phase).toBe("voting");
    expect(t.deadline()).toBeNull();
    const deadlines = t.broadcasts.filter((b) => b.name === "game:deadline").map((b) => b.data);
    expect(deadlines).toEqual([{ at: expect.any(String), key: "writing" }, null]);
  });

  it("sets nothing when the host turned the timer off", async () => {
    const t = fresh(null);
    await t.start();
    expect(t.deadline()).toBeNull();
  });

  it("only accepts the game's own timer options", () => {
    expect(() => fresh(45)).toThrow("doesn't offer a 45s timer");
  });
});

describe("defineGame checks", () => {
  const base = {
    displayName: "x",
    description: "x",
    minPlayers: 1,
    maxPlayers: 2,
    start: async () => {},
    buildPlayProps: async () => ({}),
    buildResult: async () => ({}),
    PlayComponent: Null,
    RevealComponent: Null,
    BrowsePage: Null,
  };

  it("needs onDeadline for a timer", () => {
    expect(() => defineGame({ ...base, gameType: "x", timer: { options: [30] } })).toThrow("must define onDeadline");
  });

  it("keeps action names starting with _ for core", () => {
    expect(() =>
      defineGame({ ...base, gameType: "x", sessionActions: { _deadline: { access: "player", handler: async () => ({}) } } })
    ).toThrow('names starting with "_"');
  });
});
