import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";
import { sendPushToUsers } from "@/lib/push/send";
import { expireIfStale } from "@/lib/sessions/expiry";

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

  const players = await db
    .select({ playerId: sessionPlayers.playerId, joinOrder: sessionPlayers.joinOrder })
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id))
    .orderBy(sessionPlayers.joinOrder);

  const plugin = getPlugin(session.gameType);

  if (players.length < plugin.minPlayers) {
    return NextResponse.json({ error: `Need at least ${plugin.minPlayers} player${plugin.minPlayers === 1 ? "" : "s"} to start` }, { status: 400 });
  }
  if (players.length > plugin.maxPlayers) {
    return NextResponse.json({ error: `Maximum ${plugin.maxPlayers} players allowed` }, { status: 400 });
  }
  const { tokenOrder, firstPlayerId } = await plugin.start(session, session.randomizeOrder ?? false);

  const resolvedFirstPlayerId = firstPlayerId ?? session.hostId;

  const [updated] = await db
    .update(sessions)
    .set({
      status: "in_progress",
      tokenOrder,
      currentTokenIndex: 0,
      currentPlayerId: resolvedFirstPlayerId,
      startedAt: new Date(),
    })
    .where(eq(sessions.id, session.id))
    .returning();

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
