import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, count, and } from "drizzle-orm";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server";

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
  if (session.status !== "lobby") {
    return NextResponse.json({ error: "Session already started" }, { status: 400 });
  }

  // Check if already joined
  const [existing] = await db
    .select()
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, user.id)));

  if (existing) {
    // Reactivate if was inactive
    await db
      .update(sessionPlayers)
      .set({ isActive: true })
      .where(eq(sessionPlayers.id, existing.id));
    return NextResponse.json({ ok: true });
  }

  const [{ count: playerCount }] = await db
    .select({ count: count() })
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));

  await db.insert(sessionPlayers).values({
    sessionId: session.id,
    playerId: user.id,
    joinOrder: Number(playerCount),
  });

  // Broadcast player:joined event via Supabase Realtime
  const profile = await db.select().from(profiles).where(eq(profiles.id, user.id));
  const admin = await createSupabaseAdmin();
  await admin.channel(`session:${code}`).send({
    type: "broadcast",
    event: "player:joined",
    payload: {
      type: "player:joined",
      payload: {
        playerId: user.id,
        username: profile[0]?.username ?? "Unknown",
        avatarUrl: profile[0]?.avatarUrl,
      },
    },
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
