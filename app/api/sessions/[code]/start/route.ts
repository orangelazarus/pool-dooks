import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";
import { sendPushToUsers } from "@/lib/push/send";
import { expireIfStale } from "@/lib/sessions/expiry";
import { GameError } from "@/lib/game-sdk";
import { executor, runInTransaction } from "@/lib/game-sdk/tx";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [found] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!found) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (found.hostId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const session = await expireIfStale(found);
  if (session.status === "expired") return NextResponse.json({ error: "This game expired" }, { status: 410 });
  if (session.status !== "lobby") return NextResponse.json({ error: "Already started" }, { status: 400 });

  const plugin = getPlugin(session.gameType);

  // Starting is one transaction holding a lock on the session row: the roster
  // check, the game's own start (its state joins this transaction) and the
  // switch to "in_progress" all commit together. Joining takes the same lock,
  // so nobody can slip into a game in the instant it starts, and a second
  // press of Start finds it already started.
  let started;
  try {
    started = await runInTransaction(async () => {
      const tx = executor();
      const [locked] = await tx.select().from(sessions).where(eq(sessions.id, session.id)).for("update");
      if (!locked || locked.status !== "lobby") return { error: "Already started", status: 400 } as const;

      const players = await tx
        .select({ playerId: sessionPlayers.playerId, joinOrder: sessionPlayers.joinOrder })
        .from(sessionPlayers)
        .where(and(eq(sessionPlayers.sessionId, locked.id), eq(sessionPlayers.isActive, true)))
        .orderBy(sessionPlayers.joinOrder);

      if (players.length < plugin.minPlayers) {
        const s = plugin.minPlayers === 1 ? "" : "s";
        return { error: `Need at least ${plugin.minPlayers} player${s} to start`, status: 400 } as const;
      }
      if (players.length > plugin.maxPlayers) {
        return { error: `Maximum ${plugin.maxPlayers} players allowed`, status: 400 } as const;
      }

      const { tokenOrder, firstPlayerId } = await plugin.start(locked, locked.randomizeOrder ?? false);
      const resolvedFirstPlayerId = firstPlayerId ?? locked.hostId;

      const [updated] = await tx
        .update(sessions)
        .set({
          status: "in_progress",
          tokenOrder,
          currentTokenIndex: 0,
          currentPlayerId: resolvedFirstPlayerId,
          startedAt: new Date(),
        })
        .where(eq(sessions.id, locked.id))
        .returning();

      return { updated, players, tokenOrder, resolvedFirstPlayerId };
    });
  } catch (err) {
    // A game refusing to start (e.g. the wrong number of players for it).
    if (err instanceof GameError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
  if ("error" in started) return NextResponse.json({ error: started.error }, { status: started.status });
  const { updated, players, tokenOrder, resolvedFirstPlayerId } = started;

  // Broadcast session:started
  await supabase.channel(`session:${code}`).send({
    type: "broadcast",
    event: "session:started",
    payload: {
      type: "session:started",
      payload: { tokenOrder, firstPlayerId: resolvedFirstPlayerId },
    },
  });

  const nonHostIds = players
    .map((p) => p.playerId)
    .filter((id): id is string => id !== null && id !== user.id);

  await sendPushToUsers(nonHostIds, {
    title: "Game Started!",
    body: `${plugin.displayName} has started. Get ready!`,
    url: `/sessions/${code}/play`,
  }).catch(() => {});

  return NextResponse.json(updated);
}
