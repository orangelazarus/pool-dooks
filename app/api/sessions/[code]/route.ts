import { NextRequest, NextResponse } from "next/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.shareCode, code));

  if (!session) {
    return NextResponse.json({ error: "Session not found" }, { status: 404 });
  }

  const plugin = getPlugin(session.gameType);
  const gameContentId = session.gameContentId ?? session.poolDookId;
  const contentMeta = gameContentId
    ? await plugin.getContentMeta(gameContentId).catch(() => null)
    : null;

  const players = await db
    .select({
      id: sessionPlayers.id,
      playerId: sessionPlayers.playerId,
      joinOrder: sessionPlayers.joinOrder,
      isActive: sessionPlayers.isActive,
      joinedAt: sessionPlayers.joinedAt,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
    })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(eq(sessionPlayers.sessionId, session.id))
    .orderBy(sessionPlayers.joinOrder);

  return NextResponse.json({ session, contentMeta, players });
}
