import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { generateShareCode } from "@/lib/utils/share-code";
import { getPlugin } from "@/lib/games/registry";
import { z } from "zod";

const CreateSchema = z.object({
  gameType: z.string(),
  gameContentId: z.string().uuid(),
  randomizeOrder: z.boolean().optional().default(false),
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

  const { gameType, gameContentId, randomizeOrder } = parsed.data;

  // Validate the game type and content exist via the plugin
  try {
    const plugin = getPlugin(gameType);
    await plugin.getContentMeta(gameContentId);
  } catch {
    return NextResponse.json({ error: "Game content not found" }, { status: 404 });
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

  // Add host as first player
  await db.insert(sessionPlayers).values({
    sessionId: session.id,
    playerId: user.id,
    joinOrder: 0,
  });

  return NextResponse.json({ shareCode: session.shareCode, sessionId: session.id }, { status: 201 });
}
