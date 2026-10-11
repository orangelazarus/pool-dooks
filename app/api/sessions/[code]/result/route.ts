import { NextRequest, NextResponse } from "next/server";
import { db, sessions } from "@/lib/db";
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

  const result = await getPlugin(session.gameType).buildResult(session);

  return NextResponse.json(result);
}
