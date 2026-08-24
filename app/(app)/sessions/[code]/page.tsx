import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { Lobby } from "@/components/session/Lobby";
import { GuestJoin } from "@/components/session/GuestJoin";
import { getPlugin } from "@/lib/games/registry";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) redirect("/home");

  if (session.status === "in_progress") redirect(`/sessions/${code}/play`);
  if (session.status === "completed") redirect(`/sessions/${code}/reveal`);

  const plugin = getPlugin(session.gameType);

  // Not logged in — show guest join form
  if (!user) {
    const { subtitle } = await plugin.getLobbyMeta?.(session) ?? { subtitle: "" };
    return <GuestJoin shareCode={code} gameTitle={`${plugin.displayName}${subtitle ? ` — ${subtitle}` : ""}`} />;
  }

  const players = await db
    .select({
      playerId: sessionPlayers.playerId,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
    })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(eq(sessionPlayers.sessionId, session.id))
    .orderBy(sessionPlayers.joinOrder);

  // Auto-join if not a player
  const isPlayer = players.some((p) => p.playerId === user.id);
  if (!isPlayer) {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sessions/${code}/join`, {
      method: "POST",
      headers: { cookie: (await (await import("next/headers")).cookies()).toString() },
    }).catch(() => {});
    redirect(`/sessions/${code}`);
  }

  const { subtitle } = await plugin.getLobbyMeta?.(session) ?? { subtitle: "" };

  return (
    <Lobby
      shareCode={code}
      currentUserId={user.id}
      hostId={session.hostId}
      initialPlayers={players.map((p) => ({
        playerId: p.playerId!,
        username: p.username,
        avatarUrl: p.avatarUrl,
      }))}
      gameDisplayName={plugin.displayName}
      subtitle={subtitle}
      minPlayers={plugin.minPlayers}
    />
  );
}
