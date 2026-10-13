import { and, asc, desc, eq, gt, gte } from "drizzle-orm";
import { db, profiles, sessionMessages } from "@/lib/db";
import type { ChatMessage } from "./chat-types";

/** How many messages a browser is given at once. */
export const HISTORY_LIMIT = 100;

// One player sending more than this many messages inside the window is flooding.
const FLOOD_MAX = 5;
const FLOOD_WINDOW_MS = 10 * 1000;

// A message only sends a push when the chat has been quiet this long, so a
// run of chatter is one notification rather than one per line.
const PUSH_QUIET_MS = 5 * 60 * 1000;

const columns = {
  id: sessionMessages.id,
  playerId: sessionMessages.playerId,
  username: profiles.username,
  body: sessionMessages.body,
  createdAt: sessionMessages.createdAt,
};

type Row = { id: string; playerId: string | null; username: string | null; body: string; createdAt: Date };

const toMessage = (row: Row): ChatMessage => ({
  id: row.id,
  playerId: row.playerId,
  username: row.username ?? "Someone",
  body: row.body,
  createdAt: row.createdAt.toISOString(),
});

/**
 * The latest messages, oldest first. With `since`, those from that moment on —
 * inclusive, so a browser catching up never misses one that shares a
 * timestamp with the last it has; it drops the repeats by id.
 */
export async function listMessages(sessionId: string, since?: Date): Promise<ChatMessage[]> {
  const base = db.select(columns).from(sessionMessages).leftJoin(profiles, eq(sessionMessages.playerId, profiles.id));
  if (since) {
    const rows = await base
      .where(and(eq(sessionMessages.sessionId, sessionId), gte(sessionMessages.createdAt, since)))
      .orderBy(asc(sessionMessages.createdAt))
      .limit(HISTORY_LIMIT);
    return rows.map(toMessage);
  }
  const rows = await base
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(desc(sessionMessages.createdAt))
    .limit(HISTORY_LIMIT);
  return rows.reverse().map(toMessage);
}

export async function isFlooding(sessionId: string, playerId: string): Promise<boolean> {
  const recent = await db
    .select({ id: sessionMessages.id })
    .from(sessionMessages)
    .where(
      and(
        eq(sessionMessages.sessionId, sessionId),
        eq(sessionMessages.playerId, playerId),
        gt(sessionMessages.createdAt, new Date(Date.now() - FLOOD_WINDOW_MS))
      )
    )
    .limit(FLOOD_MAX);
  return recent.length >= FLOOD_MAX;
}

/** Whether nobody has said anything for a while. Ask before adding the new message. */
export async function isQuiet(sessionId: string): Promise<boolean> {
  const [latest] = await db
    .select({ createdAt: sessionMessages.createdAt })
    .from(sessionMessages)
    .where(eq(sessionMessages.sessionId, sessionId))
    .orderBy(desc(sessionMessages.createdAt))
    .limit(1);
  return !latest || latest.createdAt.getTime() < Date.now() - PUSH_QUIET_MS;
}

export async function addMessage(sessionId: string, playerId: string, username: string, body: string): Promise<ChatMessage> {
  const [row] = await db
    .insert(sessionMessages)
    .values({ sessionId, playerId, body })
    .returning({ id: sessionMessages.id, createdAt: sessionMessages.createdAt });
  return toMessage({ ...row, playerId, username, body });
}
