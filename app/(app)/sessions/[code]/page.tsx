import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { and, eq } from "drizzle-orm";
import { Lobby } from "@/components/session/Lobby";
import { GuestJoin } from "@/components/session/GuestJoin";
import { SessionNotice } from "@/components/session/SessionNotice";
import { EXPIRED_MESSAGE, expireIfStale, lobbyExpiresAt } from "@/lib/sessions/expiry";
import { getPlugin } from "@/lib/games/registry";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [found] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!found) redirect("/home");
  const session = await expireIfStale(found);

  if (session.status === "expired") {
    return <SessionNotice title="This game expired" message={EXPIRED_MESSAGE} />;
  }
  if (session.status === "in_progress") redirect(`/sessions/${code}/play`);
  if (session.status === "completed") redirect(`/sessions/${code}/reveal`);

  const plugin = getPlugin(session.gameType);

  const { subtitle } = await plugin.getLobbyMeta?.(session) ?? { subtitle: "" };

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

  // Removed by the host: they don't get auto-joined back in.
  if (user) {
    const [mine] = await db
      .select({ kicked: sessionPlayers.kicked })
      .from(sessionPlayers)
      .where(and(eq(sessionPlayers.sessionId, session.id), eq(sessionPlayers.playerId, user.id)));
    if (mine?.kicked) {
      return <SessionNotice title="You were removed from this game" message="The host removed you from this lobby." />;
    }
  }

  const isPlayer = !!user && players.some((p) => p.playerId === user.id);
  const isFull = players.length >= plugin.maxPlayers;

  // A full lobby takes no more players. If the game is public the extra
  // arrivals wait here as spectators and watch once it starts; a private game
  // has nothing for them to see.
  const isSpectator = !isPlayer && isFull;
  if (isSpectator && !session.isPublic) {
    return (
      <SessionNotice
        title="This lobby is full"
        message={`${plugin.displayName} takes up to ${plugin.maxPlayers} players, and this game is private.`}
        signInNext={user ? undefined : `/sessions/${code}`}
      />
    );
  }

  if (!isSpectator) {
    // Not logged in — show guest join form
    if (!user) {
      return <GuestJoin shareCode={code} gameTitle={`${plugin.displayName}${subtitle ? ` — ${subtitle}` : ""}`} />;
    }

    // Auto-join if not a player
    if (!isPlayer) {
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/sessions/${code}/join`, {
        method: "POST",
        headers: { cookie: (await (await import("next/headers")).cookies()).toString() },
      }).catch(() => {});
      redirect(`/sessions/${code}`);
    }
  }

  return (
    <Lobby
      shareCode={code}
      currentUserId={user?.id ?? ""}
      hostId={session.hostId}
      initialPlayers={players.map((p) => ({
        playerId: p.playerId!,
        username: p.username,
        avatarUrl: p.avatarUrl,
      }))}
      gameDisplayName={plugin.displayName}
      subtitle={subtitle}
      minPlayers={plugin.minPlayers}
      isPublic={session.isPublic}
      expiresAt={lobbyExpiresAt(session)?.toISOString() ?? null}
      isSpectator={isSpectator}
    />
  );
}
