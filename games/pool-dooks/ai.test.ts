import { describe, expect, it } from "vitest";
import { createTestContent } from "@/lib/game-sdk/testing";
import { EXTRA_WEIRD_SYSTEM_PROMPT } from "./ai/prompts";
import { plugin } from "./plugin";

const story = {
  title: "Soup Day",
  body_text: "The {{t1}} ate soup.",
  tokens: [{ id: "t1", label: "noun", type: "noun", position: 0, occurrence: 1 }],
};

describe("Pool Dooks AI", () => {
  it("generates a draft through ctx.ai", async () => {
    const t = createTestContent(plugin, { ai: { generate: [story] } });
    const draft = await t.act<{ title: string; bodyText: string; bodyJson: unknown }>("generate", { theme: "food", extraWeird: true });
    expect(draft).toMatchObject({ title: "Soup Day", bodyText: "The {{t1}} ate soup." });
    expect(draft.bodyJson).toBeTruthy();
    expect(t.aiCalls[0]).toMatchObject({ use: "generate", request: { system: EXTRA_WEIRD_SYSTEM_PROMPT } });
  });

  it("sends a scanned page as one image", async () => {
    const t = createTestContent(plugin, { ai: { scan: [story] } });
    await t.act("scan", { mediaType: "image/png", data: "AAAA" });
    expect(t.aiCalls[0].request.input).toContainEqual({ type: "image", mediaType: "image/png", data: "AAAA" });
  });

  it("is for accounts, not guests", async () => {
    const t = createTestContent(plugin, { viewer: { id: "g", isGuest: true } });
    await expect(t.act("enhance", { text: "Once upon a time there was a cat." })).rejects.toMatchObject({ status: 403 });
  });
});
