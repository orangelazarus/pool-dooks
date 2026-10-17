import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { getViewerRole } from "@/lib/sessions/access";
import { addMessage, isFlooding, isQuiet, listMessages } from "@/lib/sessions/chat";
import { MAX_MESSAGE_LENGTH } from "@/lib/sessions/chat-types";
import { sendPushToUsers } from "@/lib/push/send";

const PostSchema = z.object({ body: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH) });
const MAX_PUSH_BODY = 120;

type Params = { params: Promise<{ code: string }> };

/**
 * The session's chat, for anyone allowed to see the session: its players, and
 * spectators when it is public. `canPost` tells the browser whether to offer
 * an input.
 */
export async function GET(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session || session.status === "expired") return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const role = await getViewerRole(session, user?.id);
  if (role === "denied") return NextResponse.json({ error: "This game is private" }, { status: 403 });

  const after = req.nextUrl.searchParams.get("after");
  const since = after ? new Date(after) : undefined;
  const messages = await listMessages(session.id, since && !Number.isNaN(since.getTime()) ? since : undefined);

  return NextResponse.json({ messages, canPost: role === "player", viewerId: user?.id ?? null });
}

/** Posts a message. Players of the session only. */
export async function POST(req: NextRequest, { params }: Params) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session || session.status === "expired") return NextResponse.json({ error: "Session not found" }, { status: 404 });
  if ((await getViewerRole(session, user.id)) !== "player") {
    return NextResponse.json({ error: "Only players can chat" }, { status: 403 });
  }

  const parsed = PostSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: `Messages need 1 to ${MAX_MESSAGE_LENGTH} characters` }, { status: 400 });
  }
  if (await isFlooding(session.id, user.id)) {
    return NextResponse.json({ error: "Slow down a little" }, { status: 429 });
  }

  const [profile] = await db.select({ username: profiles.username }).from(profiles).where(eq(profiles.id, user.id));
  const username = profile?.username ?? "A player";

  // Decided before the insert: afterwards the chat is never quiet.
  const notify = await isQuiet(session.id);
  const message = await addMessage(session.id, user.id, username, parsed.data.body);

  // The channel can be joined by anyone who knows its name, so this says only
  // that there is something new. Browsers fetch it through GET, which checks
  // who is asking.
  await supabase
    .channel(`chat:${code}`)
    .send({ type: "broadcast", event: "chat:message", payload: {} })
    .then(() => {}, () => {});

  if (notify) {
    const players = await db
      .select({ playerId: sessionPlayers.playerId })
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)));
    await sendPushToUsers(
      players.map((p) => p.playerId).filter((id) => id !== user.id),
      {
        title: `${username} in chat`,
        body: message.body.length > MAX_PUSH_BODY ? `${message.body.slice(0, MAX_PUSH_BODY - 1)}…` : message.body,
        url: `/sessions/${code}`,
      }
    ).catch(() => {});
  }

  return NextResponse.json({ message }, { status: 201 });
}
