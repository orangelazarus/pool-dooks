// A player leaving a session, or the host removing one. Leaving is always an
// explicit act: closing the tab or losing the connection never removes anyone,
// so going back to the invite link drops a player straight into their seat.
//
// In the lobby a player who left may come back through the invite link; one
// the host removed may not. Mid-game, leaving is final, and only possible in
// games that say how to carry on without someone (onPlayerLeft).
import { and, asc, eq } from "drizzle-orm";
import { sessions, sessionPlayers } from "@/lib/db";
import { sendSessionEvent } from "@/lib/realtime/server";
import { getPlugin } from "@/lib/games/registry";
import { executor, runInTransaction } from "@/lib/game-sdk/tx";
import { GameError } from "@/lib/game-sdk/errors";

export type LeaveReason = "left" | "kicked";

// A GameError keeps the writes before it (see tx.ts). A game refusing in
// onPlayerLeft must undo the removal too, so its refusal travels as this.
class Refused extends Error {
  constructor(public readonly reply: GameError) {
    super(reply.message);
  }
}

/**
 * Takes `playerId` out of the session with this share code. `actorId` is who
 * asked: the player themselves for "left", the host for "kicked". Throws a
 * GameError to refuse.
 */
export async function removePlayer(shareCode: string, actorId: string, playerId: string, reason: LeaveReason) {
  const outcome = await runInTransaction(async () => {
    const tx = executor();
    // The same lock join and start take, so nobody joins or starts mid-removal.
    const [session] = await tx.select().from(sessions).where(eq(sessions.shareCode, shareCode)).for("update");
    if (!session) throw new GameError(404, "Session not found");
    if (session.status !== "lobby" && session.status !== "in_progress") throw new GameError(400, "This game is over");

    if (reason === "kicked") {
      if (actorId !== session.hostId) throw new GameError(403, "Only the host can remove players");
      if (playerId === actorId) throw new GameError(400, "To go yourself, leave the game");
    } else if (actorId !== playerId) {
      throw new GameError(403, "You can only leave for yourself");
    }

    const plugin = getPlugin(session.gameType);
    if (session.status === "in_progress" && !plugin.supportsLeaving) {
      throw new GameError(409, `${plugin.displayName} can't continue without a player`);
    }

    const [seat] = await tx
      .update(sessionPlayers)
      .set({ isActive: false, ...(reason === "kicked" ? { kicked: true } : {}) })
      .where(
        and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, playerId), eq(sessionPlayers.isActive, true))
      )
      .returning({ id: sessionPlayers.id });
    if (!seat) throw new GameError(404, "That player isn't in this game");

    // The host's job passes to whoever joined next.
    let hostId = session.hostId;
    if (playerId === session.hostId) {
      const [next] = await tx
        .select({ playerId: sessionPlayers.playerId })
        .from(sessionPlayers)
        .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)))
        .orderBy(asc(sessionPlayers.joinOrder))
        .limit(1);
      if (next) hostId = next.playerId;
    }

    const [after] = await tx
      .update(sessions)
      .set({
        hostId,
        // An empty lobby has nobody left to start it.
        ...(session.status === "lobby" && hostId === playerId ? { status: "expired" } : {}),
      })
      .where(eq(sessions.id, session.id))
      .returning();

    if (after.status === "in_progress") {
      await plugin.playerLeft(after, playerId, reason).catch((err) => {
        throw err instanceof GameError ? new Refused(err) : err;
      });
    }
    return { hostChanged: hostId !== session.hostId ? hostId : null };
  }).catch((err) => {
    throw err instanceof Refused ? err.reply : err;
  });

  // Told only once it has committed.
  await sendSessionEvent(shareCode, "player:left", { playerId, reason });
  if (outcome.hostChanged) await sendSessionEvent(shareCode, "host:changed", { hostId: outcome.hostChanged });
}
