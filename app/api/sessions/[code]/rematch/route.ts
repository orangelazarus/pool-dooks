import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import type { Rematch } from "@/lib/db/schema";
import { sendPushToUsers } from "@/lib/push/send";

/**
 * Opens a "play again" proposal on a completed session. Any player may do this.
 * While one is pending the call is a no-op that returns the existing proposal,
 * so two players pressing at once can't create competing prompts.
 */
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
  if (session.status !== "completed") {
    return NextResponse.json({ error: "Session not complete" }, { status: 400 });
  }

  const [membership] = await db
    .select({ id: sessionPlayers.id })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, user.id)));
  if (!membership) return NextResponse.json({ error: "Not a player in this session" }, { status: 403 });

  // Already proposed — hand back the current state rather than starting over.
  if (session.rematch) {
    return NextResponse.json({ rematch: session.rematch, alreadyPending: true });
  }

  const [profile] = await db
    .select({ username: profiles.username })
    .from(profiles)
    .where(eq(profiles.id, user.id));

  // The proposer counts as confirmed — they just asked for it.
  const rematch: Rematch = {
    proposedBy: user.id,
    proposedAt: new Date().toISOString(),
    accepted: [user.id],
    declined: [],
    newSessionCode: null,
  };

  await db.update(sessions).set({ rematch }).where(eq(sessions.id, session.id));

  const proposedByUsername = profile?.username ?? "A player";

  await supabase.channel(`session:${code}`).send({
    type: "broadcast",
    event: "rematch:proposed",
    payload: {
      type: "rematch:proposed",
      payload: { proposedBy: user.id, proposedByUsername },
    },
  });

  const others = await db
    .select({ playerId: sessionPlayers.playerId })
    .from(sessionPlayers)
    .where(eq(sessionPlayers.sessionId, session.id));

  await sendPushToUsers(
    others.map((p) => p.playerId).filter((id): id is string => id !== null && id !== user.id),
    {
      title: "Play again?",
      body: `${proposedByUsername} wants another round with this group.`,
      url: `/sessions/${code}/reveal`,
    }
  ).catch(() => {});

  return NextResponse.json({ rematch }, { status: 201 });
}
