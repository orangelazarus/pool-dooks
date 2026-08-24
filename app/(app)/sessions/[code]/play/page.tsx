import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/sessions/${code}`);

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) redirect("/home");
  if (session.status === "lobby") redirect(`/sessions/${code}`);
  if (session.status === "completed") redirect(`/sessions/${code}/reveal`);

  const players = await db
    .select({
      playerId: sessionPlayers.playerId,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
    })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.isActive, true)))
    .orderBy(sessionPlayers.joinOrder);

  const plugin = getPlugin(session.gameType);
  const gameProps = await plugin.buildPlayProps(
    session,
    players.map((p, i) => ({
      playerId: p.playerId!,
      username: p.username ?? "Unknown",
      avatarUrl: p.avatarUrl,
      joinOrder: i,
    }))
  );

  const { PlayComponent } = plugin;

  return (
    <PlayComponent
      shareCode={code}
      currentUserId={user.id}
      hostId={session.hostId}
      players={players.map((p) => ({
        playerId: p.playerId!,
        username: p.username ?? "Unknown",
        avatarUrl: p.avatarUrl ?? undefined,
      }))}
      {...gameProps}
    />
  );
}
