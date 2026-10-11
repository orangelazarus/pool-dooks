import { and, count, eq } from "drizzle-orm";
import { db, sessionPlayers } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import { getPlugin } from "@/lib/games/registry";

// player   — on the roster
// observer — not on the roster, but the session is public so they may watch
// denied   — not on the roster of a private session
export type ViewerRole = "player" | "observer" | "denied";

/** What a viewer (possibly logged out) may do with a session. */
export async function getViewerRole(
  session: Pick<Session, "id" | "isPublic">,
  userId: string | null | undefined
): Promise<ViewerRole> {
  if (userId) {
    const [membership] = await db
      .select({ id: sessionPlayers.id })
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, userId)));
    if (membership) return "player";
  }
  return session.isPublic ? "observer" : "denied";
}

/** Has the lobby reached the game's player limit? */
export async function isLobbyFull(session: Pick<Session, "id" | "gameType">): Promise<boolean> {
  const [{ count: playerCount }] = await db
    .select({ count: count() })
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));
  return Number(playerCount) >= getPlugin(session.gameType).maxPlayers;
}
