import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, answers, sessionPlayers, profiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { sendPushToUser, sendPushToUsers } from "@/lib/push/send";
import { getPlugin } from "@/lib/games/registry";
import { answerPush, nextTurnPush, type AnnouncedAnswer } from "@/lib/sessions/answer-announcement";

const Schema = z.object({
  tokenId: z.string(),
  value: z.string().min(1).max(500),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
    if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    if (session.status !== "in_progress") {
      return NextResponse.json({ error: "Session not in progress" }, { status: 400 });
    }
    if (session.currentPlayerId !== user.id) {
      return NextResponse.json({ error: "Not your turn" }, { status: 403 });
    }

    const tokenOrder = session.tokenOrder as string[];
    const currentTokenId = tokenOrder[session.currentTokenIndex ?? 0];
    if (currentTokenId !== parsed.data.tokenId) {
      return NextResponse.json({ error: "Wrong token" }, { status: 400 });
    }

    // Token may already be answered (repeated token id)
    const [existing] = await db
      .select()
      .from(answers)
      .where(and(eq(answers.sessionId, session.id), eq(answers.tokenId, parsed.data.tokenId)));

    if (!existing) {
      await db.insert(answers).values({
        sessionId: session.id,
        playerId: user.id,
        tokenId: parsed.data.tokenId,
        value: parsed.data.value,
      });
    }

    const nextIndex = (session.currentTokenIndex ?? 0) + 1;
    const isComplete = nextIndex >= tokenOrder.length;
    const plugin = getPlugin(session.gameType);

    const players = await db
      .select({ playerId: sessionPlayers.playerId, joinOrder: sessionPlayers.joinOrder })
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)))
      .orderBy(sessionPlayers.joinOrder);
    const otherIds = players
      .map((p) => p.playerId)
      .filter((id): id is string => id !== null && id !== user.id);

    const currentPlayerIndex = players.findIndex((p) => p.playerId === user.id);
    const nextPlayerId = isComplete ? null : players[(currentPlayerIndex + 1) % players.length].playerId!;
    const nextTokenId = isComplete ? null : tokenOrder[nextIndex];

    const hints = await plugin.getAnswerHints({
      session,
      tokenId: parsed.data.tokenId,
      value: parsed.data.value,
      nextTokenId,
      nextPlayerId,
    }).catch(() => ({ nextTokenLabel: undefined, answered: undefined }));

    // Only games that opt in (by describing the answered blank) share answers
    // during play. For a repeated token the stored answer is the first one given.
    let announced: AnnouncedAnswer | null = null;
    if (hints.answered) {
      const [profile] = await db.select({ username: profiles.username }).from(profiles).where(eq(profiles.id, user.id));
      announced = {
        username: profile?.username ?? "A player",
        value: existing?.value ?? parsed.data.value,
        label: hints.answered.label,
        tokenType: hints.answered.type,
      };
    }

    // Non-critical: broadcast answer confirmed
    supabase.channel(`session:${code}`).send({
      type: "broadcast",
      event: "answer:confirmed",
      payload: {
        type: "answer:confirmed",
        payload: { tokenId: parsed.data.tokenId, playerId: user.id, answer: announced ?? undefined },
      },
    }).catch(() => {});

    if (isComplete) {
      const completedAt = new Date();
      await db
        .update(sessions)
        .set({ status: "completed", completedAt, currentTokenIndex: nextIndex })
        .where(eq(sessions.id, session.id));

      Promise.all([
        supabase.channel(`session:${code}`).send({
          type: "broadcast",
          event: "session:completed",
          payload: { type: "session:completed", payload: { completedAt: completedAt.toISOString() } },
        }),
        supabase.channel(`session:${code}`).send({
          type: "broadcast",
          event: "session:revealed",
          payload: { type: "session:revealed", payload: {} },
        }),
        sendPushToUsers(otherIds, {
          title: "Story revealed!",
          body: "All blanks filled — come see the hilarious result!",
          url: `/sessions/${code}/reveal`,
        }),
      ]).catch(() => {});
    } else {
      await db
        .update(sessions)
        .set({ currentTokenIndex: nextIndex, currentPlayerId: nextPlayerId })
        .where(eq(sessions.id, session.id));

      const playUrl = `/sessions/${code}/play`;
      // The next player hears about the answer in their "your turn" push;
      // everyone else gets the answer on its own.
      const bystanderIds = otherIds.filter((id) => id !== nextPlayerId);

      Promise.all([
        supabase.channel(`session:${code}`).send({
          type: "broadcast",
          event: "turn:changed",
          payload: {
            type: "turn:changed",
            payload: {
              currentTokenId: nextTokenId!,
              currentPlayerId: nextPlayerId!,
              tokenIndex: nextIndex,
              total: tokenOrder.length,
            },
          },
        }),
        nextPlayerId !== user.id
          ? sendPushToUser(nextPlayerId!, nextTurnPush(playUrl, hints.nextTokenLabel, announced))
          : Promise.resolve(),
        announced && bystanderIds.length > 0
          ? sendPushToUsers(bystanderIds, answerPush(playUrl, announced))
          : Promise.resolve(),
      ]).catch(() => {});
    }

    return NextResponse.json({ ok: true, isComplete });
  } catch (err) {
    console.error("[answer]", err);
    const message = err instanceof Error ? err.message : "Failed to submit answer";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
