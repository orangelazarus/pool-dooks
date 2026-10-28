import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db, gameContent, profiles, sessionPlayers, sessions } from "@/lib/db";

export interface FinishedSession {
  shareCode: string;
  completedAt: string | null;
  /** The viewer played in it. */
  mine: boolean;
  /** Who finished it, in seat order. */
  players: string[];
  /** The setup it was played with, e.g. "Discus of Wealth — 3 puzzles + bonus round". */
  title: string | null;
  /** How to start a new game with the same rules, or null if the setup is gone or isn't the viewer's to use. */
  playAgain: { gameContentId: string; timerSeconds: number | null; randomize: boolean } | null;
}

/**
 * Finished games of one game type that the viewer may look back on: the ones
 * they played, and public ones. Newest first.
 */
export async function listFinishedSessions(gameType: string, viewerId: string | null, limit = 20): Promise<FinishedSession[]> {
  const played = viewerId
    ? sql<boolean>`exists (select 1 from ${sessionPlayers} where ${sessionPlayers.sessionId} = ${sessions.id} and ${sessionPlayers.playerId} = ${viewerId} and ${sessionPlayers.isActive})`
    : sql<boolean>`false`;

  const rows = await db
    .select({
      id: sessions.id,
      shareCode: sessions.shareCode,
      completedAt: sessions.completedAt,
      timerSeconds: sessions.timerSeconds,
      randomize: sessions.randomizeOrder,
      mine: played,
      contentId: gameContent.id,
      title: gameContent.title,
      contentPublic: gameContent.isPublic,
      authorId: gameContent.authorId,
    })
    .from(sessions)
    .leftJoin(gameContent, eq(sessions.gameContentId, gameContent.id))
    .where(and(eq(sessions.gameType, gameType), eq(sessions.status, "completed"), or(eq(sessions.isPublic, true), played)))
    .orderBy(desc(sql`coalesce(${sessions.completedAt}, ${sessions.createdAt})`))
    .limit(limit);
  if (rows.length === 0) return [];

  const seats = await db
    .select({ sessionId: sessionPlayers.sessionId, username: profiles.username })
    .from(sessionPlayers)
    .innerJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(and(inArray(sessionPlayers.sessionId, rows.map((r) => r.id)), eq(sessionPlayers.isActive, true)))
    .orderBy(sessionPlayers.joinOrder);

  return rows.map((row) => {
    // The same rule as getVisibleContent: public, or the viewer's own.
    const usable = row.contentId && (row.contentPublic || (viewerId !== null && row.authorId === viewerId));
    return {
      shareCode: row.shareCode,
      completedAt: row.completedAt?.toISOString() ?? null,
      mine: !!row.mine,
      players: seats.filter((s) => s.sessionId === row.id).map((s) => s.username),
      title: row.title,
      playAgain: usable
        ? { gameContentId: row.contentId!, timerSeconds: row.timerSeconds, randomize: !!row.randomize }
        : null,
    };
  });
}
