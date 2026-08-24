import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { sendPushToUsers } from "@/lib/push/send";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.hostId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (session.status !== "completed") {
    return NextResponse.json({ error: "Session not complete" }, { status: 400 });
  }

  await supabase.channel(`session:${code}`).send({
    type: "broadcast",
    event: "session:revealed",
    payload: { type: "session:revealed", payload: {} },
  });

  const players = await db
    .select({ playerId: sessionPlayers.playerId })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id)));

  const playerIds = players
    .map((p) => p.playerId)
    .filter((id): id is string => id !== null && id !== user.id);

  await sendPushToUsers(playerIds, {
    title: "The story is revealed!",
    body: "Come see the hilarious Pool Dook result!",
    url: `/${code}/reveal`,
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
