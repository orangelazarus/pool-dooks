import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, profiles, sessionPlayers } from "@/lib/db";
import { desc, eq, inArray, sql } from "drizzle-orm";

/**
 * Reports the caller's own open "play again" proposal, if any, so the create
 * screen can tell them their group is coming along. Share codes are 6 chars from
 * a fixed alphabet, so this static path can never shadow a real /api/sessions/[code].
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ pending: null });

  const [open] = await db
    .select()
    .from(sessions)
    .where(
      sql`${sessions.rematch}->>'proposedBy' = ${user.id} AND ${sessions.rematch}->>'newSessionCode' IS NULL`
    )
    .orderBy(desc(sessions.completedAt))
    .limit(1);

  if (!open?.rematch) return NextResponse.json({ pending: null });

  // Report only players still on the roster of the finished session.
  const roster = new Set(
    (
      await db
        .select({ playerId: sessionPlayers.playerId })
        .from(sessionPlayers)
        .where(eq(sessionPlayers.sessionId, open.id))
    )
      .map((p) => p.playerId)
      .filter((id): id is string => id !== null)
  );
  const confirmed = open.rematch.accepted.filter((id) => roster.has(id));

  const named = confirmed.length
    ? await db
        .select({ id: profiles.id, username: profiles.username })
        .from(profiles)
        .where(inArray(profiles.id, confirmed))
    : [];

  return NextResponse.json({
    pending: {
      fromCode: open.shareCode,
      players: confirmed.map(
        (id) => named.find((n) => n.id === id)?.username ?? "A player"
      ),
    },
  });
}
