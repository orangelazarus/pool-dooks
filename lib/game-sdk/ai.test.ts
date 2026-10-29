import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineGame } from "@/lib/game-sdk";
import { createTestContent } from "@/lib/game-sdk/testing";

const Null = () => null;
const Story = z.object({ title: z.string() });

const base = {
  displayName: "Writer",
  description: "test",
  minPlayers: 1,
  maxPlayers: 2,
  async start() {},
  buildPlayProps: async () => ({}),
  buildResult: async () => ({}),
  PlayComponent: Null,
  RevealComponent: Null,
  BrowsePage: Null,
};

const plugin = defineGame({
  ...base,
  gameType: "writer_test",
  ai: { title: { tier: "fast", maxInputChars: 50, maxOutputTokens: 100, output: Story, perUserPerDay: 5 } },
  contentActions: {
    suggest: {
      auth: "account",
      input: z.object({ theme: z.string() }),
      handler: async (ctx, { theme }: { theme: string }) =>
        ctx.ai.run<z.infer<typeof Story>>("title", { system: "Suggest a title.", input: theme }),
    },
  },
});

describe("ctx.ai in the test harness", () => {
  it("returns the scripted reply and records the call", async () => {
    const t = createTestContent(plugin, { ai: { title: [{ title: "Soup Day" }] } });
    expect(await t.act("suggest", { theme: "food" })).toEqual({ title: "Soup Day" });
    expect(t.aiCalls).toEqual([{ use: "title", request: { system: "Suggest a title.", input: "food" } }]);
  });

  it("applies the declared input limit", async () => {
    const t = createTestContent(plugin, { ai: { title: [{ title: "x" }] } });
    await expect(t.act("suggest", { theme: "a".repeat(51) })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses guests", async () => {
    const t = createTestContent(plugin, { viewer: { id: "g", isGuest: true } });
    await expect(t.act("suggest", { theme: "food" })).rejects.toMatchObject({ status: 403 });
  });

  it("rejects a scripted reply that doesn't fit the output", async () => {
    const t = createTestContent(plugin, { ai: { title: ["just text"] } });
    await expect(t.act("suggest", { theme: "food" })).rejects.toThrow(/output schema/);
  });
});

describe("defineGame({ ai })", () => {
  it("refuses a use over core's ceilings", () => {
    expect(() =>
      defineGame({
        ...base,
        gameType: "greedy_test",
        ai: { essay: { tier: "smart", maxInputChars: 50, maxOutputTokens: 64_000, output: Story, perUserPerDay: 5 } },
      })
    ).toThrow(/maxOutputTokens/);
  });
});
