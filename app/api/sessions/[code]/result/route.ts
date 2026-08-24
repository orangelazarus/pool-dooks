import { NextRequest, NextResponse } from "next/server";
import { db, sessions, answers, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  const { code } = await params;

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if (session.status !== "completed") {
    return NextResponse.json({ error: "Not yet complete" }, { status: 400 });
  }

  const sessionAnswers = await db
    .select({
      tokenId: answers.tokenId,
      value: answers.value,
      playerId: answers.playerId,
      username: profiles.username,
    })
    .from(answers)
    .leftJoin(profiles, eq(answers.playerId, profiles.id))
    .where(eq(answers.sessionId, session.id));

  const plugin = getPlugin(session.gameType);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await plugin.buildResult(session, sessionAnswers as any);

  return NextResponse.json(result);
}
