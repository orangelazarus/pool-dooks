import { redirect } from "next/navigation";
import { db, sessions, sessionPlayers, answers, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { getPlugin } from "@/lib/games/registry";
import { buttonVariants } from "@/components/ui/button";
import { RematchPrompt } from "@/components/session/RematchPrompt";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function RevealPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, code));
  if (!session) redirect("/home");
  if (session.status !== "completed") redirect(`/sessions/${code}`);

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
  const { RevealComponent } = plugin;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const players = await db
    .select({ playerId: sessionPlayers.playerId, username: profiles.username })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(eq(sessionPlayers.sessionId, session.id))
    .orderBy(sessionPlayers.joinOrder);

  // Only players of this session can carry the group forward.
  const canRematch = !!user && players.some((p) => p.playerId === user.id);
  const rematch = session.rematch;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <RevealComponent {...result} />
      <div className="flex justify-center mt-8 gap-3">
        <Link href="/home" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          🏠 Home
        </Link>
        {canRematch ? (
          <RematchPrompt
            shareCode={code}
            browsePath={plugin.browsePath}
            currentUserId={user.id}
            players={players.map((p) => ({
              playerId: p.playerId!,
              username: p.username ?? "Unknown",
            }))}
            initialProposedBy={rematch?.proposedBy ?? null}
            initialAccepted={rematch?.accepted ?? []}
            initialDeclined={rematch?.declined ?? []}
            initialNewSessionCode={rematch?.newSessionCode ?? null}
          />
        ) : (
          <Link href="/sessions/new" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
            Play Again
          </Link>
        )}
      </div>
    </div>
  );
}
