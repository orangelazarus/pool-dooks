import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, count, and } from "drizzle-orm";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server";
import { getPlugin } from "@/lib/games/registry";
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
  const session = await expireIfStale(found);
  if (session.status === "expired") return NextResponse.json({ error: "This game expired" }, { status: 410 });
  if (session.status !== "lobby") {
    return NextResponse.json({ error: "Session already started" }, { status: 400 });
  }

  // Decided under a lock on the session row, so two people arriving at the
  // same moment can't both take the last seat or the same join order.
  const outcome = await db.transaction(async (tx) => {
    const [locked] = await tx.select().from(sessions).where(eq(sessions.id, session.id)).for("update");
    if (!locked || locked.status !== "lobby") return "started" as const;

    const [existing] = await tx
      .select()
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, user.id)));
    if (existing) {
      // Reactivate if was inactive. Existing players can always return.
      await tx.update(sessionPlayers).set({ isActive: true }).where(eq(sessionPlayers.id, existing.id));
      return "rejoined" as const;
    }

    const [{ count: playerCount }] = await tx
      .select({ count: count() })
      .from(sessionPlayers)
      .where(eq(sessionPlayers.sessionId, session.id));
    if (Number(playerCount) >= getPlugin(session.gameType).maxPlayers) return "full" as const;

    await tx.insert(sessionPlayers).values({
      sessionId: session.id,
      playerId: user.id,
      joinOrder: Number(playerCount),
    });
    return "joined" as const;
  });

  if (outcome === "started") return NextResponse.json({ error: "Session already started" }, { status: 400 });
  if (outcome === "full") return NextResponse.json({ error: "Lobby is full" }, { status: 409 });
  if (outcome === "rejoined") return NextResponse.json({ ok: true });

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
