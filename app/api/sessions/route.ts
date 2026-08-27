import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers } from "@/lib/db";
import { eq, desc, sql } from "drizzle-orm";
import { generateShareCode } from "@/lib/utils/share-code";
import { getPlugin } from "@/lib/games/registry";
import type { Rematch } from "@/lib/db/schema";
import { sendPushToUsers } from "@/lib/push/send";
import { z } from "zod";

const CreateSchema = z.object({
  gameType: z.string(),
  gameContentId: z.string().uuid(),
  randomizeOrder: z.boolean().optional().default(false),
  /**
   * Share code of a completed session whose confirmed players carry over. Usually
   * omitted — the caller's own open proposal is resolved server-side instead, so
   * the group survives however they navigate off to pick content.
   */
  rematchFrom: z.string().optional(),
  /** Set to skip carrying a group over even if the caller has an open proposal. */
  skipRematch: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { gameType, gameContentId, randomizeOrder, rematchFrom, skipRematch } = parsed.data;

  // Validate the game type and content exist via the plugin
  try {
    const plugin = getPlugin(gameType);
    await plugin.getContentMeta(gameContentId);
  } catch {
    return NextResponse.json({ error: "Game content not found" }, { status: 404 });
  }

  // Resolve which finished session, if any, is handing its group over. Only the
  // player who opened the prompt can do this, and only while it's still open.
  let previous: { id: string; shareCode: string; rematch: Rematch; carryOver: string[] } | null = null;
  if (!skipRematch) {
    const [old] = rematchFrom
      ? await db.select().from(sessions).where(eq(sessions.shareCode, rematchFrom))
      : // Picking content means navigating away from the reveal, which drops any
        // URL state — so fall back to whatever proposal this player left open.
        await db
          .select()
          .from(sessions)
          .where(
            sql`${sessions.rematch}->>'proposedBy' = ${user.id} AND ${sessions.rematch}->>'newSessionCode' IS NULL`
          )
          .orderBy(desc(sessions.completedAt))
          .limit(1);

    if (rematchFrom && !old?.rematch) {
      return NextResponse.json({ error: "No rematch pending" }, { status: 400 });
    }
    if (old?.rematch) {
      if (old.rematch.proposedBy !== user.id) {
        return NextResponse.json({ error: "Only the proposer can start the next round" }, { status: 403 });
      }
      if (old.rematch.newSessionCode) {
        return NextResponse.json({ error: "Next round already started", shareCode: old.rematch.newSessionCode }, { status: 409 });
      }

      // Only carry over players who actually belonged to the finished session.
      const wasPlayer = new Set(
        (
          await db
            .select({ playerId: sessionPlayers.playerId })
            .from(sessionPlayers)
            .where(eq(sessionPlayers.sessionId, old.id))
        )
          .map((p) => p.playerId)
          .filter((id): id is string => id !== null)
      );
      const confirmed = old.rematch.accepted.filter((id) => wasPlayer.has(id));

      previous = {
        id: old.id,
        shareCode: old.shareCode,
        rematch: old.rematch,
        // Proposer first so they keep join order 0 as host of the new session.
        carryOver: [user.id, ...confirmed.filter((id) => id !== user.id)],
      };
    }
  }

  // Generate unique share code
  let shareCode = generateShareCode();
  for (let attempts = 0; attempts < 5; attempts++) {
    const existing = await db.select({ id: sessions.id }).from(sessions).where(eq(sessions.shareCode, shareCode));
    if (!existing.length) break;
    shareCode = generateShareCode();
  }

  const [session] = await db
    .insert(sessions)
    .values({
      shareCode,
      gameType,
      gameContentId,
      hostId: user.id,
      randomizeOrder,
    })
    .returning();

  // Seed players: just the host normally, or the whole confirmed group on a rematch.
  const roster = previous?.carryOver ?? [user.id];
  await db.insert(sessionPlayers).values(
    roster.map((playerId, joinOrder) => ({
      sessionId: session.id,
      playerId,
      joinOrder,
    }))
  );

  if (previous) {
    await db
      .update(sessions)
      .set({ rematch: { ...previous.rematch, newSessionCode: shareCode } })
      .where(eq(sessions.id, previous.id));

    // Tell everyone still watching the old session where the next round lives.
    await supabase.channel(`session:${previous.shareCode}`).send({
      type: "broadcast",
      event: "rematch:ready",
      payload: { type: "rematch:ready", payload: { shareCode } },
    });

    await sendPushToUsers(
      roster.filter((id) => id !== user.id),
      {
        title: "Next round is ready!",
        body: "Your group is back in the lobby. Come join.",
        url: `/sessions/${shareCode}`,
      }
    ).catch(() => {});
  }

  return NextResponse.json({ shareCode: session.shareCode, sessionId: session.id }, { status: 201 });
}
