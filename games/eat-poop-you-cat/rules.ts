// The game's rules, as pure functions of the state. No I/O: plugin.ts wires them up.
import { GameError } from "@/lib/game-sdk";
import type { Book, EpycContent, EpycState, EpycView, Entry, Task, TaskKind } from "./schema";

/** Books for `seating` (already shuffled): each starts with its owner and passes down the line. */
export function freshState(seating: string[], content: EpycContent, mode: EpycState["mode"]): EpycState {
  const n = seating.length;
  const length = content.steps === "full" ? n : Math.min(content.steps, n);
  const books: Book[] = seating.map((ownerId, i) => ({
    id: `b${i}`,
    ownerId,
    holders: Array.from({ length }, (_, k) => seating[(i + k) % n]),
    entries: [],
  }));
  return { mode, round: 0, books };
}

export const isDone = (book: Book) => book.entries.length >= book.holders.length;
export const isComplete = (state: EpycState) => state.books.every(isDone);

/** Whether `me` can fill the book's next entry now. */
export function ready(state: EpycState, book: Book, me: string): boolean {
  if (isDone(book) || book.holders[book.entries.length] !== me) return false;
  return state.mode === "async" || book.entries.length === state.round;
}

/** The books waiting for `me`, earliest turn first. */
export function tasksFor(state: EpycState, me: string): Book[] {
  return state.books.filter((b) => ready(state, b, me)).sort((a, b) => a.entries.length - b.entries.length);
}

const lastReal = (book: Book) => [...book.entries].reverse().find((e) => e.kind !== "skipped");

/** What the next entry is: decided by the last real one, so skips never leave a mismatch. */
export function taskKind(book: Book): TaskKind {
  const last = lastReal(book);
  if (!last) return "start";
  return last.kind === "text" ? "draw" : "describe";
}

export function taskFor(book: Book): Task {
  const kind = taskKind(book);
  const last = lastReal(book);
  return {
    bookId: book.id,
    step: book.entries.length,
    kind,
    ...(last?.kind === "text" ? { text: last.text } : {}),
    ...(last?.kind === "drawing" ? { drawing: last.drawing } : {}),
  };
}

function withBook(state: EpycState, bookId: string, change: (book: Book) => Book): EpycState {
  return { ...state, books: state.books.map((b) => (b.id === bookId ? change(b) : b)) };
}

/** `me` fills a book's next entry. `step` guards against a double submit. */
export function addEntry(state: EpycState, bookId: string, step: number, me: string, entry: Entry): EpycState {
  const book = state.books.find((b) => b.id === bookId);
  if (!book) throw new GameError(400, "That book doesn't exist");
  if (book.entries.length !== step) throw new GameError(409, "That turn is already over");
  if (!ready(state, book, me)) throw new GameError(400, "That book isn't yours right now");
  const kind = taskKind(book);
  if ((kind === "draw") !== (entry.kind === "drawing")) {
    throw new GameError(400, kind === "draw" ? "This turn needs a drawing" : "This turn needs words");
  }
  return withBook(state, bookId, (b) => ({ ...b, entries: [...b.entries, entry] }));
}

/** Marks everything waiting for `playerId` as skipped. */
export function skipTasks(state: EpycState, playerId: string): EpycState {
  const ids = new Set(tasksFor(state, playerId).map((b) => b.id));
  if (ids.size === 0) return state;
  return {
    ...state,
    books: state.books.map((b) => (ids.has(b.id) ? { ...b, entries: [...b.entries, { kind: "skipped", by: playerId }] } : b)),
  };
}

/** Live mode: books still open on this turn. */
const pending = (state: EpycState) => state.books.filter((b) => !isDone(b) && b.entries.length === state.round);

/** Live mode: time's up. Whatever wasn't handed in is skipped, and everyone moves on. */
export function closeRound(state: EpycState): EpycState {
  const open = new Set(pending(state).map((b) => b.id));
  return {
    ...state,
    round: state.round + 1,
    books: state.books.map((b) =>
      open.has(b.id) ? { ...b, entries: [...b.entries, { kind: "skipped", by: b.holders[b.entries.length] }] } : b
    ),
  };
}

/** Live mode: moves to the next turn once nothing is open on this one. */
export function maybeAdvance(state: EpycState): EpycState {
  if (state.mode !== "live" || isComplete(state) || pending(state).length > 0) return state;
  return { ...state, round: state.round + 1 };
}

/** Someone left: their finished work stays, and their turns still to come pass to whoever is next. */
export function removePlayer(state: EpycState, playerId: string): EpycState {
  return maybeAdvance({
    ...state,
    books: state.books.map((b) => ({
      ...b,
      holders: b.holders.filter((id, i) => i < b.entries.length || id !== playerId),
    })),
  });
}

/** The holder of the viewer's next unfinished book, when that's someone else. */
function waitingOn(state: EpycState, me: string): string | null {
  let best: { step: number; holder: string } | null = null;
  for (const b of state.books) {
    if (isDone(b)) continue;
    const step = b.holders.findIndex((id, i) => i >= b.entries.length && id === me);
    if (step === -1) continue;
    const holder = b.holders[b.entries.length];
    if (holder === me) continue;
    if (!best || step < best.step) best = { step, holder };
  }
  return best?.holder ?? null;
}

export function viewFor(state: EpycState, playerIds: string[], viewerId: string | null): EpycView {
  const progress = playerIds.map((playerId) => ({
    playerId,
    done: state.books.reduce((n, b) => n + b.entries.filter((e) => e.by === playerId).length, 0),
    total: state.books.reduce((n, b) => n + b.holders.filter((id) => id === playerId).length, 0),
    ready: tasksFor(state, playerId).length,
  }));
  const mine = viewerId ? progress.find((p) => p.playerId === viewerId) : undefined;
  const tasks = mine ? tasksFor(state, mine.playerId) : [];
  return {
    mode: state.mode,
    round: state.round,
    totalSteps: Math.max(0, ...state.books.map((b) => b.holders.length)),
    task: tasks[0] ? taskFor(tasks[0]) : null,
    queued: Math.max(0, tasks.length - 1),
    waitingOn: mine && tasks.length === 0 ? waitingOn(state, mine.playerId) : null,
    myDone: mine?.done ?? 0,
    myTotal: mine?.total ?? 0,
    progress,
  };
}

/** Collapses whitespace; refuses text that's too short or too long. */
export function cleanText(raw: string, min: number, max: number): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (text.length < min) throw new GameError(400, "Write a little more than that");
  if (text.length > max) throw new GameError(400, `Keep it under ${max} characters`);
  return text;
}
