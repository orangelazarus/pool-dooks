// Database access for game plugins. Internal to the SDK: games reach it only
// through the ContentApi / StateApi objects built in context.ts, which pin
// every call to one gameType (and, for state, one session). Queries go
// through executor(), so inside a game action they join its transaction.
import { and, count, desc, eq, gte, ilike, lte, or, sql } from "drizzle-orm";
import { gameContent, gameState, profiles, sessions } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import { GameError, StateConflictError } from "./errors";
import { executor } from "./tx";
import type { ContentListOptions, ContentRecord, Deadline } from "./types";

// Generous for a board position or a story; small enough that a buggy or
// hostile caller can't use game storage as a dumping ground.
export const MAX_STORED_BYTES = 256 * 1024;
export const MAX_TITLE_LENGTH = 200;
// Guest accounts are free, so creating content is capped per author, across
// every game. The busiest real author has made 38 in a day (chess makes one per game).
export const MAX_CONTENT_PER_DAY = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertSize(value: unknown, what: string, max = MAX_STORED_BYTES) {
  const bytes = Buffer.byteLength(JSON.stringify(value ?? null), "utf8");
  if (bytes > max) throw new GameError(413, `${what} is too large`);
}

function cleanTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new GameError(400, "A title is required");
  if (trimmed.length > MAX_TITLE_LENGTH) throw new GameError(400, "That title is too long");
  return trimmed;
}

const contentColumns = {
  id: gameContent.id,
  authorId: gameContent.authorId,
  authorName: profiles.username,
  title: gameContent.title,
  isPublic: gameContent.isPublic,
  data: gameContent.data,
  createdAt: gameContent.createdAt,
};

const selectContent = () =>
  executor().select(contentColumns).from(gameContent).leftJoin(profiles, eq(gameContent.authorId, profiles.id));

/** Any row of this game, private or not. Core only: games get getVisibleContent. */
export async function getContent<C>(gameType: string, id: string): Promise<ContentRecord<C> | null> {
  if (!UUID.test(id)) return null;
  const [row] = await selectContent().where(and(eq(gameContent.gameType, gameType), eq(gameContent.id, id)));
  return (row as ContentRecord<C> | undefined) ?? null;
}

/** A row `viewerId` may see: public, or their own. Same rule as listContent. */
export async function getVisibleContent<C>(gameType: string, id: string, viewerId: string | null): Promise<ContentRecord<C> | null> {
  const row = await getContent<C>(gameType, id);
  return row && (row.isPublic || (viewerId !== null && row.authorId === viewerId)) ? row : null;
}

export async function listContent<C>(
  gameType: string,
  viewerId: string | null,
  options: ContentListOptions = {}
): Promise<ContentRecord<C>[]> {
  if (options.mine && !viewerId) return [];

  const conditions = [eq(gameContent.gameType, gameType)];
  if (options.mine) {
    conditions.push(eq(gameContent.authorId, viewerId!));
  } else {
    // Never list someone else's private content.
    conditions.push(
      viewerId ? or(eq(gameContent.isPublic, true), eq(gameContent.authorId, viewerId))! : eq(gameContent.isPublic, true)
    );
  }
  if (options.search?.trim()) {
    const escaped = options.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`);
    conditions.push(ilike(gameContent.title, `%${escaped}%`));
  }
  if (options.where && Object.keys(options.where).length > 0) {
    conditions.push(sql`${gameContent.data} @> ${JSON.stringify(options.where)}::jsonb`);
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const rows = await selectContent()
    .where(and(...conditions))
    .orderBy(desc(gameContent.createdAt))
    .limit(limit);
  return rows as ContentRecord<C>[];
}

export async function createContent<C>(
  gameType: string,
  authorId: string,
  input: { title: string; data: C; isPublic?: boolean }
): Promise<ContentRecord<C>> {
  assertSize(input.data, "This content");
  const [made] = await executor()
    .select({ n: count() })
    .from(gameContent)
    .where(and(eq(gameContent.authorId, authorId), gte(gameContent.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
  if (made.n >= MAX_CONTENT_PER_DAY) throw new GameError(429, "You've made a lot today. Try again tomorrow.");
  const [row] = await executor()
    .insert(gameContent)
    .values({ gameType, authorId, title: cleanTitle(input.title), isPublic: input.isPublic ?? true, data: input.data })
    .returning({ id: gameContent.id });
  return (await getContent<C>(gameType, row.id))!;
}

/** Loads a row for changing it, refusing anyone but its author. */
async function ownContent(gameType: string, id: string, viewerId: string) {
  const existing = await getContent(gameType, id);
  if (!existing) throw new GameError(404, "Not found");
  if (existing.authorId !== viewerId) throw new GameError(403, "Only the author can change this");
}

export async function updateContent<C>(
  gameType: string,
  id: string,
  viewerId: string,
  patch: { title?: string; data?: C; isPublic?: boolean }
): Promise<ContentRecord<C>> {
  await ownContent(gameType, id, viewerId);
  if (patch.data !== undefined) assertSize(patch.data, "This content");
  await executor()
    .update(gameContent)
    .set({
      ...(patch.title !== undefined ? { title: cleanTitle(patch.title) } : {}),
      ...(patch.data !== undefined ? { data: patch.data } : {}),
      ...(patch.isPublic !== undefined ? { isPublic: patch.isPublic } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(gameContent.gameType, gameType), eq(gameContent.id, id)));
  return (await getContent<C>(gameType, id))!;
}

export async function removeContent(gameType: string, id: string, viewerId: string): Promise<void> {
  await ownContent(gameType, id, viewerId);
  await executor().delete(gameContent).where(and(eq(gameContent.gameType, gameType), eq(gameContent.id, id)));
}

// ── Session state ───────────────────────────────────────────────────────────

type Stored<S> = { data: S; version: number };

export async function getState<S>(gameType: string, sessionId: string): Promise<Stored<S> | null> {
  const [row] = await executor()
    .select({ data: gameState.data, version: gameState.version })
    .from(gameState)
    .where(and(eq(gameState.sessionId, sessionId), eq(gameState.gameType, gameType)));
  return (row as Stored<S> | undefined) ?? null;
}

export async function initState<S>(gameType: string, sessionId: string, data: S): Promise<Stored<S>> {
  assertSize(data, "The game state");
  await executor().insert(gameState).values({ sessionId, gameType, data }).onConflictDoNothing();
  return (await getState<S>(gameType, sessionId))!;
}

export async function updateState<S>(
  gameType: string,
  sessionId: string,
  data: S,
  expectedVersion: number
): Promise<Stored<S>> {
  assertSize(data, "The game state");
  const [row] = await executor()
    .update(gameState)
    .set({ data, version: expectedVersion + 1, updatedAt: new Date() })
    .where(
      and(
        eq(gameState.sessionId, sessionId),
        eq(gameState.gameType, gameType),
        eq(gameState.version, expectedVersion)
      )
    )
    .returning({ data: gameState.data, version: gameState.version });
  if (!row) throw new StateConflictError();
  return row as Stored<S>;
}

/**
 * Locks the session's row for the rest of the transaction and returns it as it
 * is now. Leaving and kicking take the same lock first (lib/sessions/leave.ts),
 * so an action and a departure can't interleave: whichever waits sees the other's result.
 */
export async function lockSession(sessionId: string): Promise<Session | null> {
  const [row] = await executor().select().from(sessions).where(eq(sessions.id, sessionId)).for("update");
  return row ?? null;
}

// ── Deadlines: at most one per session, on its sessions row ────────────────

export async function getDeadline(sessionId: string): Promise<Deadline | null> {
  const [row] = await executor()
    .select({ at: sessions.deadlineAt, key: sessions.deadlineKey })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  return row?.at && row.key ? { at: row.at, key: row.key } : null;
}

export async function setDeadline(sessionId: string, deadline: Deadline | null): Promise<void> {
  await executor()
    .update(sessions)
    .set({ deadlineAt: deadline?.at ?? null, deadlineKey: deadline?.key ?? null })
    .where(eq(sessions.id, sessionId));
}

/**
 * Takes a deadline that has passed, by clearing it, and returns its key. Must
 * run inside a transaction. The row lock is the claim: when two requests race,
 * the second waits on it, then re-checks and finds nothing left to take.
 * (Not UPDATE … RETURNING: that would return the key after it was cleared.)
 */
export async function claimDueDeadline(sessionId: string, now: Date): Promise<string | null> {
  const [due] = await executor()
    .select({ key: sessions.deadlineKey })
    .from(sessions)
    .where(and(eq(sessions.id, sessionId), eq(sessions.status, "in_progress"), lte(sessions.deadlineAt, now)))
    .for("update");
  if (!due?.key) return null;
  await setDeadline(sessionId, null);
  return due.key;
}
