import { describe, expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
// Core caps one game-state row at this (lib/game-sdk/storage.ts).
const MAX_STORED_BYTES = 256 * 1024;
import { plugin } from "./plugin";
import { CANVAS_SIZE, MAX_DRAWING_CHARS, encodeDrawing, type Point, type Stroke } from "./drawing";
import type { EpycContent, EpycState, EpycView } from "./schema";

type T = ReturnType<typeof createTestSession<EpycContent, EpycState>>;

const DOODLE = encodeDrawing([{ color: 0, size: 1, points: [[10, 10], [60, 80], [120, 40]] }]);

const viewOf = (t: T, id: string | null) => t.as(id).act<EpycView>("state");

/** `id` does their current task with something sensible. */
async function play(t: T, id: string, drawing = DOODLE) {
  const { task } = await viewOf(t, id);
  if (!task) throw new Error(`${id} has nothing to do`);
  const value = task.kind === "draw" ? { drawing } : { text: `${id} at step ${task.step}` };
  return t.as(id).act<EpycView & { finished: boolean }>("submit", { bookId: task.bookId, step: task.step, ...value });
}

/** Who sits after whom: book holders are rotations of the seating. */
const seating = (t: T) => t.state()!.books.map((b) => b.ownerId);
const next = (t: T, id: string) => {
  const seats = seating(t);
  return seats[(seats.indexOf(id) + 1) % seats.length];
};

/** A busy drawing just under the size limit. */
function biggestDrawing(): string {
  const strokes: Stroke[] = [];
  let x = 160;
  let y = 160;
  for (;;) {
    const points: Point[] = [];
    for (let i = 0; i < 30; i++) {
      x = Math.min(CANVAS_SIZE, Math.max(0, x + ((i * 7919) % 41) - 20));
      y = Math.min(CANVAS_SIZE, Math.max(0, y + ((i * 104729) % 37) - 18));
      points.push([x, y]);
    }
    const candidate = [...strokes, { color: strokes.length % 8, size: 1, points }];
    if (encodeDrawing(candidate).length > MAX_DRAWING_CHARS) return encodeDrawing(strokes);
    strokes.push(candidate[candidate.length - 1]);
  }
}

describe("at your own pace", () => {
  it("passes each book along until every player has added to every book", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" } });
    await t.start();
    expect(t.deadline()).toBeNull();

    // Everyone starts their own book.
    for (const id of t.playerIds) expect((await viewOf(t, id)).task?.kind).toBe("start");
    for (const id of t.playerIds) await play(t, id);

    // Then draws the book passed to them, then describes the next.
    for (const id of t.playerIds) expect((await viewOf(t, id)).task?.kind).toBe("draw");
    for (const id of t.playerIds) await play(t, id);
    for (const id of t.playerIds) expect((await viewOf(t, id)).task?.kind).toBe("describe");
    await play(t, "ann");
    await play(t, "bob");
    const last = await play(t, "cat");

    expect(last.finished).toBe(true);
    expect(t.status()).toBe("completed");
    const { books } = (await t.result()) as { books: Array<{ owner: string; entries: Array<{ kind: string; by: string }> }> };
    expect(books).toHaveLength(3);
    for (const b of books) {
      expect(b.entries.map((e) => e.kind)).toEqual(["text", "drawing", "text"]);
      expect(b.entries[0].by).toBe(b.owner);
    }
  });

  it("lets a player run ahead through a queue, and only waits on the player before", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat", "dan"], content: { steps: "full" } });
    await t.start();
    const a = seating(t)[0];
    const b = next(t, a);
    const c = next(t, b);

    await play(t, a);
    await play(t, b);
    // b's own book reached c, and a's reached b.
    const cView = await viewOf(t, c);
    expect(cView.task?.kind).toBe("start");
    expect(cView.queued).toBe(1);
    await play(t, c);
    expect((await viewOf(t, c)).task?.kind).toBe("draw");

    // a is waiting on the player before them, who hasn't started yet.
    const aView = await viewOf(t, a);
    expect(aView.task).toBeNull();
    expect(aView.waitingOn).toBe(seating(t)[3]);
  });

  it("pushes once when a player's queue fills, not for every book", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" } });
    await t.start();
    const [a, b] = seating(t);

    await play(t, b); // b's book reaches c, who still has their own to start: no push
    expect(t.notifications).toHaveLength(0);
    await play(t, a); // a's book reaches b, whose queue was empty: one push
    expect(t.notifications).toHaveLength(1);
    expect(t.notifications[0]).toMatchObject({ to: [b] });
    expect(t.notifications[0].body).toMatch(/draw/);
  });

  it("refuses a double submit, someone else's book, and the wrong kind of entry", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" } });
    await t.start();
    const [a, b] = seating(t);
    const { task } = await viewOf(t, a);
    await t.as(a).act("submit", { bookId: task!.bookId, step: 0, text: "A cat running for mayor" });
    await expect(t.as(a).act("submit", { bookId: task!.bookId, step: 0, text: "Again" })).rejects.toMatchObject({ status: 409 });
    await expect(t.as(a).act("submit", { bookId: task!.bookId, step: 1, drawing: DOODLE })).rejects.toThrow("isn't yours");
    await expect(t.as(b).act("submit", { bookId: task!.bookId, step: 1, text: "words" })).rejects.toThrow("needs a drawing");
    await expect(t.as(b).act("submit", { bookId: task!.bookId, step: 1, drawing: "!!" })).rejects.toThrow("couldn't be read");
    await expect(t.as(b).act("submit", { bookId: task!.bookId, step: 1, drawing: "" })).rejects.toThrow("Draw something");
    const own = (await viewOf(t, b)).task!;
    await expect(t.as(b).act("submit", { bookId: own.bookId, step: 0, text: " x " })).rejects.toThrow("a little more");
  });

  it("caps book length at the setting", async () => {
    const t = createTestSession(plugin, { players: 6, content: { steps: 4 } });
    await t.start();
    expect(t.state()!.books.every((b) => b.holders.length === 4)).toBe(true);
    expect((await viewOf(t, "p1")).myTotal).toBe(4);
  });

  it("lets the host skip a player who has gone quiet", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" } });
    await t.start();
    const quiet = t.playerIds.find((id) => id !== "ann")!;
    await expect(t.as("bob").act("skip", { playerId: quiet })).rejects.toMatchObject({ status: 403 });
    await t.as("ann").act("skip", { playerId: quiet });
    await expect(t.as("ann").act("skip", { playerId: quiet })).rejects.toThrow("Nothing is waiting");

    // Their book was never started, so whoever gets it next starts it.
    const book = t.state()!.books.find((b) => b.ownerId === quiet)!;
    expect(book.entries).toEqual([{ kind: "skipped", by: quiet }]);
    expect((await viewOf(t, next(t, quiet))).queued).toBe(1);
  });

  it("carries on without a player who leaves, even before they started their book", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat", "dan"], content: { steps: "full" } });
    await t.start();
    const [a, , , d] = seating(t);
    await play(t, a);
    await t.leave(d);

    const books = t.state()!.books;
    expect(books.every((b) => b.holders.every((id, i) => id !== d || i < b.entries.length))).toBe(true);
    // Play everything out with the three who are left.
    for (let guard = 0; guard < 50 && t.status() !== "completed"; guard++) {
      for (const id of t.playerIds) if ((await viewOf(t, id)).task) await play(t, id);
    }
    expect(t.status()).toBe("completed");
    const { books: shown } = (await t.result()) as { books: unknown[] };
    // d's book had nothing in it when they left, but the next player started it.
    expect(shown).toHaveLength(4);
  });

  it("shows a spectator progress but nobody's pages", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" }, isPublic: true });
    await t.start();
    await play(t, "ann");
    const watcher = await viewOf(t, null);
    expect(watcher.task).toBeNull();
    expect(watcher.myTotal).toBe(0);
    expect(JSON.stringify(watcher)).not.toContain("ann at step");
    expect(watcher.progress.find((p) => p.playerId === "ann")?.done).toBe(1);
  });

  it("fits eight players' worth of the biggest drawings in one state row", async () => {
    const t = createTestSession(plugin, { players: 8, content: { steps: "full" } });
    await t.start();
    const big = biggestDrawing();
    expect(big.length).toBeGreaterThan(MAX_DRAWING_CHARS - 200);
    for (let guard = 0; guard < 20 && t.status() !== "completed"; guard++) {
      for (const id of t.playerIds) if ((await viewOf(t, id)).task) await play(t, id, big);
    }
    expect(t.status()).toBe("completed");
    expect(Buffer.byteLength(JSON.stringify(t.state()))).toBeLessThan(MAX_STORED_BYTES);
  });
});

describe("live, on a timer", () => {
  it("moves everyone on together, early once all have handed in", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" }, timerSeconds: 60 });
    await t.start();
    expect(t.deadline()?.key).toBe("round:0");

    await play(t, "ann");
    // ann's book is with the next player, but they can't draw it until the turn changes.
    const after = await viewOf(t, next(t, "ann"));
    expect(after.task?.kind).toBe("start");
    expect(after.queued).toBe(0);

    await play(t, "bob");
    await play(t, "cat");
    expect(t.state()!.round).toBe(1);
    expect(t.deadline()?.key).toBe("round:1");
    expect(t.notifications).toHaveLength(0);
  });

  it("skips whoever runs out of time", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" }, timerSeconds: 60 });
    await t.start();
    await play(t, "ann");
    await t.clock.advance(60_000);

    const state = t.state()!;
    expect(state.round).toBe(1);
    expect(state.books.filter((b) => b.entries[0].kind === "skipped")).toHaveLength(2);
    // The book ann started gets drawn; the skipped ones get started by the next player.
    expect((await viewOf(t, next(t, "ann"))).task?.kind).toBe("draw");
    const skipped = state.books.find((b) => b.entries[0].kind === "skipped")!;
    expect((await viewOf(t, skipped.holders[1])).task?.kind).toBe("start");

    // Nobody plays: the game ends on the clock.
    await t.clock.advance(60_000);
    await t.clock.advance(60_000);
    expect(t.status()).toBe("completed");
    expect(t.deadline()).toBeNull();
  });

  it("ignores a stale deadline", async () => {
    const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { steps: "full" }, timerSeconds: 60 });
    await t.start();
    await t.withContext(null, (ctx) => ctx.deadline.set(1000, "round:5"));
    await t.clock.advance(1000);
    expect(t.state()!.round).toBe(0);
    expect(t.state()!.books.every((b) => b.entries.length === 0)).toBe(true);
  });
});
