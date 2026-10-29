import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LIMITS, checkAiRequest, checkAiUse, refusalFor, remaining, type Tally } from "./limits";
import { costMicros, MODELS } from "./models";

const quiet: Tally = { useCalls: 0, userCalls: 0, ipCalls: 0, gameMicros: 0, siteMicros: 0, inFlight: 0 };
const old = { perUserPerDay: 10, accountAgeHours: 1000 };
const use = {
  tier: "fast" as const,
  maxInputChars: 100,
  maxOutputTokens: 500,
  output: z.object({ title: z.string() }),
  perUserPerDay: 10,
};

describe("refusalFor", () => {
  it("lets a quiet call through", () => {
    expect(refusalFor(quiet, old)).toBeNull();
    expect(remaining(quiet, old)).toBe(10);
  });

  it("stops at each limit", () => {
    expect(refusalFor({ ...quiet, siteMicros: LIMITS.siteMicrosPerDay }, old)).toBe("site_budget");
    expect(refusalFor({ ...quiet, gameMicros: LIMITS.gameMicrosPerDay }, old)).toBe("game_budget");
    expect(refusalFor({ ...quiet, inFlight: 1 }, old)).toBe("in_flight");
    expect(refusalFor({ ...quiet, ipCalls: LIMITS.ipCallsPerDay }, old)).toBe("ip_daily");
    expect(refusalFor({ ...quiet, userCalls: LIMITS.userCallsPerDay }, old)).toBe("user_daily");
    expect(refusalFor({ ...quiet, useCalls: 10 }, old)).toBe("use_daily");
  });

  it("gives new accounts a smaller allowance", () => {
    const fresh = { ...old, accountAgeHours: 2 };
    expect(refusalFor({ ...quiet, userCalls: LIMITS.newAccountCallsPerDay - 1 }, fresh)).toBeNull();
    expect(refusalFor({ ...quiet, userCalls: LIMITS.newAccountCallsPerDay }, fresh)).toBe("new_account");
    expect(remaining(quiet, fresh)).toBe(LIMITS.newAccountCallsPerDay);
  });

  it("counts nothing left once a spend cap is reached", () => {
    expect(remaining({ ...quiet, gameMicros: LIMITS.gameMicrosPerDay }, old)).toBe(0);
    expect(remaining({ ...quiet, userCalls: LIMITS.userCallsPerDay - 2 }, old)).toBe(2);
  });
});

describe("checkAiUse", () => {
  it("accepts a sound declaration", () => expect(checkAiUse("x", use)).toBeNull());

  it("refuses declarations over core's ceilings", () => {
    expect(checkAiUse("x", { ...use, maxOutputTokens: 100_000 })).toMatch(/maxOutputTokens/);
    expect(checkAiUse("x", { ...use, maxInputChars: 0 })).toMatch(/maxInputChars/);
    expect(checkAiUse("x", { ...use, perUserPerDay: 1000 })).toMatch(/perUserPerDay/);
    expect(checkAiUse("x", { ...use, tier: "huge" as "fast" })).toMatch(/tier/);
  });

  it("requires a structured output, so a use can't hand back free text", () => {
    expect(checkAiUse("x", { ...use, output: z.string() })).toMatch(/zod object/);
  });
});

describe("checkAiRequest", () => {
  it("caps input length", () => {
    expect(checkAiRequest(use, { input: "a".repeat(100) })).toBeNull();
    expect(checkAiRequest(use, { input: "a".repeat(101) })).toMatch(/too long/);
  });

  it("refuses images unless declared, and more than one", () => {
    const image = { type: "image" as const, mediaType: "image/png", data: "AAAA" };
    expect(checkAiRequest(use, { input: [image] })).toMatch(/doesn't take images/);
    const withImages = { ...use, images: true };
    expect(checkAiRequest(withImages, { input: [image] })).toBeNull();
    expect(checkAiRequest(withImages, { input: [image, image] })).toMatch(/one image/);
    expect(checkAiRequest(withImages, { input: [{ ...image, mediaType: "image/svg+xml" }] })).toMatch(/Unsupported/);
  });
});

describe("costMicros", () => {
  it("prices tokens per model, rounding up", () => {
    expect(costMicros(MODELS.fast, 1000, 1000)).toBe(6000); // $1 + $5 per million
    expect(costMicros(MODELS.smart, 1, 0)).toBe(3);
  });
});
