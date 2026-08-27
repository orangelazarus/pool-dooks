import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import type { Rematch } from "@/lib/db/schema";
import { z } from "zod";

const RespondSchema = z.object({ accepted: z.boolean() });

/** Records one player's answer to a pending "play again" prompt. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const parsed = RespondSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { accepted } = parsed.data;

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const pending = session.rematch;
  if (!pending) return NextResponse.json({ error: "No rematch pending" }, { status: 400 });
  if (pending.newSessionCode) {
    return NextResponse.json({ error: "Next round already started" }, { status: 409 });
  }

  const [membership] = await db
    .select({ id: sessionPlayers.id })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, user.id)));
  if (!membership) return NextResponse.json({ error: "Not a player in this session" }, { status: 403 });

  // A player's latest answer wins, so drop them from both lists before re-adding.
  const rematch: Rematch = {
    ...pending,
    accepted: pending.accepted.filter((id) => id !== user.id),
    declined: pending.declined.filter((id) => id !== user.id),
  };
  (accepted ? rematch.accepted : rematch.declined).push(user.id);

  await db.update(sessions).set({ rematch }).where(eq(sessions.id, session.id));

  const [profile] = await db
    .select({ username: profiles.username })
    .from(profiles)
    .where(eq(profiles.id, user.id));

  await supabase.channel(`session:${code}`).send({
    type: "broadcast",
    event: "rematch:responded",
    payload: {
      type: "rematch:responded",
      payload: { playerId: user.id, username: profile?.username ?? "A player", accepted },
    },
  });

  return NextResponse.json({ rematch });
}
