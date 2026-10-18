import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, count, and } from "drizzle-orm";
import { sendSessionEvent } from "@/lib/realtime/server";
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
    // Removed by the host: not coming back.
    if (existing?.kicked) return "kicked" as const;
    if (existing?.isActive) return "rejoined" as const;

    const [{ count: seated }] = await tx
      .select({ count: count() })
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)));
    if (Number(seated) >= getPlugin(session.gameType).maxPlayers) return "full" as const;

    if (existing) {
      // Left the lobby earlier and came back: the same seat, active again.
      await tx.update(sessionPlayers).set({ isActive: true }).where(eq(sessionPlayers.id, existing.id));
      return "returned" as const;
    }

    // Join order only ever grows, so it stays unique after people leave.
    const [{ count: everJoined }] = await tx
      .select({ count: count() })
      .from(sessionPlayers)
      .where(eq(sessionPlayers.sessionId, session.id));
    await tx.insert(sessionPlayers).values({
      sessionId: session.id,
      playerId: user.id,
      joinOrder: Number(everJoined),
    });
    return "joined" as const;
  });

  if (outcome === "started") return NextResponse.json({ error: "Session already started" }, { status: 400 });
  if (outcome === "full") return NextResponse.json({ error: "Lobby is full" }, { status: 409 });
  if (outcome === "kicked") return NextResponse.json({ error: "The host removed you from this game" }, { status: 403 });
  if (outcome === "rejoined") return NextResponse.json({ ok: true });

  const profile = await db.select().from(profiles).where(eq(profiles.id, user.id));
  await sendSessionEvent(code, "player:joined", {
    playerId: user.id,
    username: profile[0]?.username ?? "Unknown",
    avatarUrl: profile[0]?.avatarUrl,
  });

  return NextResponse.json({ ok: true }, { status: 201 });
}
