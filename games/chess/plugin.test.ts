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

const vsComputer = (hostColor: "white" | "black", players: string[] = ["ann"]) =>
  createTestSession(plugin, {
    players,
    content: { hostColor, timeControlSeconds: null, opponent: "computer" as const, level: "easy" as const },
  });

it("against a friend, the game waits for a second player", async () => {
  const t = createTestSession(plugin, { players: ["ann"], content: { hostColor: "white", timeControlSeconds: null } });
  await expect(t.start()).rejects.toThrow("Waiting for your opponent to join");
});

it("the computer replies to the player's move", async () => {
  const t = vsComputer("white");
  await t.start();
  expect(t.currentPlayerId()).toBe("ann");
  await t.as("ann").act("move", { from: "e2", to: "e4" });
  expect(t.deadline()?.key).toBe("computer:1");
  expect(t.state()!.moves).toHaveLength(1);

  await t.clock.advance(2000);
  expect(t.state()!.moves).toHaveLength(2);
  expect(t.deadline()).toBeNull();
  // Back to the player, who can move again.
  await t.as("ann").act("move", { from: "d2", to: "d4" });
  expect(t.state()!.moves).toHaveLength(3);
}, 20_000);

it("the player's browser can ask for the computer's reply straight away", async () => {
  const t = vsComputer("white");
  await t.start();
  await t.as("ann").act("move", { from: "e2", to: "e4" });
  await t.as("ann").act("computer");
  expect(t.state()!.moves).toHaveLength(2);
  expect(t.deadline()).toBeNull(); // The backstop was cleared.
  // Asking again on the player's turn changes nothing.
  await t.as("ann").act("computer");
  expect(t.state()!.moves).toHaveLength(2);
}, 20_000);

it("the computer opens when it plays white", async () => {
  const t = vsComputer("black");
  await t.start();
  expect(t.state()).toMatchObject({ whitePlayerId: "computer", blackPlayerId: "ann" });
  await expect(t.as("ann").act("move", { from: "e7", to: "e5" })).rejects.toThrow("Not your turn");
  await t.clock.advance(2000);
  expect(t.state()!.moves).toHaveLength(1);
}, 20_000);

it("the computer declines a draw it isn't losing", async () => {
  const t = vsComputer("white");
  await t.start();
  await expect(t.as("ann").act("draw", { action: "offer" })).rejects.toThrow("declined");
  expect(t.status()).toBe("in_progress");
}, 20_000);

it("someone else in a game against the computer only watches", async () => {
  const t = vsComputer("white", ["ann", "bob"]);
  await t.start();
  await expect(t.as("bob").act("move", { from: "e2", to: "e4" })).rejects.toThrow("Not a player");
  await t.leave("bob");
  expect(t.status()).toBe("in_progress");
  await t.as("ann").act("resign");
  expect(await t.result()).toMatchObject({ white: "ann", black: "Computer (Easy)", result: "black" });
}, 20_000);

it("the computer takes a draw when it's losing", async () => {
  const t = vsComputer("white");
  await t.start();
  // 1.e4 e5 2.Qh5 Qh4?? 3.Qxh4: the computer (black) is a queen down.
  t.setState({ ...t.state()!, moves: ["e4", "e5", "Qh5", "Qh4", "Qxh4"] });
  await t.as("ann").act("draw", { action: "offer" });
  expect(t.state()).toMatchObject({ result: "draw", resultReason: "agreement" });
}, 20_000);
