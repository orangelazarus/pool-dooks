import { expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";

it("a player who leaves forfeits", async () => {
  const t = createTestSession(plugin, { players: ["ann", "bob"], content: { hostColor: "white", timeControlSeconds: null } });
  await t.start();
  await t.as("ann").act("move", { from: "e2", to: "e4" });
  await t.leave("ann");
  expect(t.status()).toBe("completed");
  expect(t.state()).toMatchObject({ result: "black", resultReason: "forfeit" });
  // The reveal still names the player who left.
  expect(await t.result()).toMatchObject({ white: "ann", black: "bob" });
});
