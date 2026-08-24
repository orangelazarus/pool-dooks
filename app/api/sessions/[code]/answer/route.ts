import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, answers, sessionPlayers } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { sendPushToUser, sendPushToUsers } from "@/lib/push/send";
import { getPlugin } from "@/lib/games/registry";

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

    // Non-critical: broadcast answer confirmed
    supabase.channel(`session:${code}`).send({
      type: "broadcast",
      event: "answer:confirmed",
      payload: {
        type: "answer:confirmed",
        payload: { tokenId: parsed.data.tokenId, playerId: user.id },
      },
    }).catch(() => {});

    const nextIndex = (session.currentTokenIndex ?? 0) + 1;
    const isComplete = nextIndex >= tokenOrder.length;
    const plugin = getPlugin(session.gameType);

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
        db.select({ playerId: sessionPlayers.playerId })
          .from(sessionPlayers)
          .where(eq(sessionPlayers.sessionId, session.id))
          .then((players) => {
            const otherIds = players
              .map((p) => p.playerId)
              .filter((id): id is string => id !== null && id !== user.id);
            return sendPushToUsers(otherIds, {
              title: "Story revealed!",
              body: "All blanks filled — come see the hilarious result!",
              url: `/${code}/reveal`,
            });
          }),
      ]).catch(() => {});
    } else {
      const players = await db
        .select({ playerId: sessionPlayers.playerId, joinOrder: sessionPlayers.joinOrder })
        .from(sessionPlayers)
        .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)))
        .orderBy(sessionPlayers.joinOrder);

      const currentPlayerIndex = players.findIndex((p) => p.playerId === user.id);
      const nextPlayerIndex = (currentPlayerIndex + 1) % players.length;
      const nextPlayerId = players[nextPlayerIndex].playerId!;
      const nextTokenId = tokenOrder[nextIndex];

      await db
        .update(sessions)
        .set({ currentTokenIndex: nextIndex, currentPlayerId: nextPlayerId })
        .where(eq(sessions.id, session.id));

      const hints = await plugin.getAnswerHints({
        session,
        players: players.map((p, i) => ({ playerId: p.playerId!, username: "", avatarUrl: null, joinOrder: i })),
        tokenId: parsed.data.tokenId,
        value: parsed.data.value,
        nextTokenId,
        nextPlayerId,
      }).catch(() => ({ nextTokenLabel: undefined }))
      const nextTokenLabel = hints?.nextTokenLabel;

      Promise.all([
        supabase.channel(`session:${code}`).send({
          type: "broadcast",
          event: "turn:changed",
          payload: {
            type: "turn:changed",
            payload: {
              currentTokenId: nextTokenId,
              currentPlayerId: nextPlayerId,
              tokenIndex: nextIndex,
              total: tokenOrder.length,
            },
          },
        }),
        nextPlayerId !== user.id
          ? sendPushToUser(nextPlayerId, {
              title: "Your turn!",
              body: `Fill in the blank: ${nextTokenLabel ?? "word"}`,
              url: `/${code}/play`,
            })
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
