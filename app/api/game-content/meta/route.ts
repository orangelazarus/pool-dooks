import { NextRequest, NextResponse } from "next/server";
import { getPlugin } from "@/lib/games/registry";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const gameType = searchParams.get("gameType");
  const gameContentId = searchParams.get("gameContentId");

  if (!gameType || !gameContentId) {
    return NextResponse.json({ error: "Missing gameType or gameContentId" }, { status: 400 });
  }

  try {
    const plugin = getPlugin(gameType);
    const { data: { user } } = await (await createClient()).auth.getUser();
    const meta = await plugin.getContentMeta(gameContentId, user?.id ?? null);
    return NextResponse.json({ ...meta, supportsRandomize: plugin.supportsRandomize, timer: plugin.timer });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
