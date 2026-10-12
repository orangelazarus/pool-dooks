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

    const currentIndex = session.currentTokenIndex ?? 0;
    const nextIndex = currentIndex + 1;
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
    const completedAt = new Date();

    // Record the answer and move the turn on as one step, and only if the turn
    // is still where this request found it. A second copy of the same request
    // (a double tap, a retry) finds the turn already taken and stops here,
    // before anything is announced.
    const recorded = await db.transaction(async (tx) => {
      const [advanced] = await tx
        .update(sessions)
        .set(
          isComplete
            ? { status: "completed", completedAt, currentTokenIndex: nextIndex }
            : { currentTokenIndex: nextIndex, currentPlayerId: nextPlayerId }
        )
        .where(
          and(
            eq(sessions.id, session.id),
            eq(sessions.status, "in_progress"),
            eq(sessions.currentTokenIndex, currentIndex),
            eq(sessions.currentPlayerId, user.id)
          )
        )
        .returning({ id: sessions.id });
      if (!advanced) return null;

      // A token id can repeat in the order; its first answer stands.
      const [inserted] = await tx
        .insert(answers)
        .values({ sessionId: session.id, playerId: user.id, tokenId: parsed.data.tokenId, value: parsed.data.value })
        .onConflictDoNothing()
        .returning({ value: answers.value });
      if (inserted) return inserted;

      const [existing] = await tx
        .select({ value: answers.value })
        .from(answers)
        .where(and(eq(answers.sessionId, session.id), eq(answers.tokenId, parsed.data.tokenId)));
      return existing ?? { value: parsed.data.value };
    });
    if (!recorded) return NextResponse.json({ error: "That turn was already taken" }, { status: 409 });

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
        value: recorded.value,
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
    // Logged, not returned: a database error message is no business of the client's.
    console.error("[answer]", err);
    return NextResponse.json({ error: "Failed to submit answer" }, { status: 500 });
  }
}
