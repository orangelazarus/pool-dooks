import { and, eq, lt } from "drizzle-orm";
import { db, sessions } from "@/lib/db";
import type { Session } from "@/lib/db/schema";

// A public lobby is an open invitation on the home page. One that hasn't
// started after this long has been abandoned, so it is closed rather than
// left listed. Private lobbies are untouched: a link shared with friends may
// reasonably sit for longer.
export const PUBLIC_LOBBY_TTL_MINUTES = 15;
const TTL_MS = PUBLIC_LOBBY_TTL_MINUTES * 60 * 1000;

export const EXPIRED_MESSAGE = `Public games that don't start within ${PUBLIC_LOBBY_TTL_MINUTES} minutes are closed.`;

type LobbyFields = Pick<Session, "status" | "isPublic" | "createdAt">;

/** When this lobby will be closed, or null if it never will be (private, or already started). */
export function lobbyExpiresAt(session: LobbyFields): Date | null {
  if (session.status !== "lobby" || !session.isPublic || !session.createdAt) return null;
  return new Date(session.createdAt.getTime() + TTL_MS);
}

/**
 * Nothing runs on a timer here, so lobbies are expired when they are next
 * looked at: the home page listing sweeps all of them, and anything that
 * touches one session checks that session.
 */
export async function expireStaleLobbies(): Promise<void> {
  await db
    .update(sessions)
    .set({ status: "expired" })
    .where(
      and(
        eq(sessions.status, "lobby"),
        eq(sessions.isPublic, true),
        lt(sessions.createdAt, new Date(Date.now() - TTL_MS))
      )
    );
}

/** Closes this lobby if its time is up. Returns the session as it now stands. */
export async function expireIfStale(session: Session): Promise<Session> {
  const expiresAt = lobbyExpiresAt(session);
  if (!expiresAt || expiresAt.getTime() > Date.now()) return session;

  // Guarded on status so a host who starts the game at the last moment wins.
  const [expired] = await db
    .update(sessions)
    .set({ status: "expired" })
    .where(and(eq(sessions.id, session.id), eq(sessions.status, "lobby")))
    .returning();
  if (expired) return expired;

  const [current] = await db.select().from(sessions).where(eq(sessions.id, session.id));
  return current ?? session;
}
