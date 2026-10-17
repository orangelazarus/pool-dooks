import { expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";

it("passes the dice on when the player whose turn it is leaves", async () => {
  const t = createTestSession(plugin, { players: 3, content: { targetScore: 10000, ruleset: "original" } });
  await t.start();
  expect(t.currentPlayerId()).toBe("p1");
  await t.as("p1").act("roll");
  await t.leave("p1");
  expect(t.currentPlayerId()).toBe("p2");
  expect(t.state()).toMatchObject({ diceRolled: null, turnScore: 0 });

  // Down to one player, the game ends.
  await t.leave("p3");
  expect(t.status()).toBe("completed");
});
