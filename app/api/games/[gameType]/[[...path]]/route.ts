import { NextRequest, NextResponse } from "next/server";
import { getPlugin } from "@/lib/games/registry";

type Params = { params: Promise<{ gameType: string; path?: string[] }> };

async function handle(req: NextRequest, { params }: Params) {
  const { gameType, path = [] } = await params;

  let plugin;
  try {
    plugin = getPlugin(gameType);
  } catch {
    return NextResponse.json({ error: "Unknown game type" }, { status: 404 });
  }

  if (!plugin.handleRequest) {
    return NextResponse.json({ error: "This game has no content API" }, { status: 404 });
  }

  return plugin.handleRequest(req, path);
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
