import { and, eq } from "drizzle-orm";
import { db, sessionPlayers } from "@/lib/db";
import type { Session } from "@/lib/db/schema";

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
      .where(
        and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, userId), eq(sessionPlayers.isActive, true))
      );
    if (membership) return "player";
  }
  return session.isPublic ? "observer" : "denied";
}
