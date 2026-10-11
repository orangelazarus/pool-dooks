import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";
import { getViewerRole } from "@/lib/sessions/access";
import { SessionNotice } from "@/components/session/SessionNotice";
import { Eye } from "lucide-react";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) redirect("/home");
  if (session.status === "lobby") redirect(`/sessions/${code}`);
  if (session.status === "completed") redirect(`/sessions/${code}/reveal`);

  // Players play. Anyone else may watch a public game, and is turned away from
  // a private one.
  const role = await getViewerRole(session, user?.id);
  if (role === "denied") {
    return (
      <SessionNotice
        title="This game is private"
        message="Only its players can see a private game while it's being played."
        signInNext={user ? undefined : `/sessions/${code}/play`}
      />
    );
  }

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
  const gameProps = await plugin.buildPlayProps(session);

  const { PlayComponent } = plugin;

  const board = (
    <PlayComponent
      shareCode={code}
      // Observers have no seat: an id that matches no player keeps every
      // game's play screen in its read-only "waiting" state.
      currentUserId={role === "player" ? user!.id : ""}
      hostId={session.hostId}
      players={players.map((p) => ({
        playerId: p.playerId!,
        username: p.username ?? "Unknown",
        avatarUrl: p.avatarUrl ?? undefined,
      }))}
      {...gameProps}
    />
  );
  if (role === "player") return board;

  return (
    <>
      <div className="border-b bg-muted/50" data-observer-banner>
        <p className="max-w-lg mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Eye className="h-4 w-4" />
          You&apos;re watching this game
        </p>
      </div>
      {board}
    </>
  );
}
