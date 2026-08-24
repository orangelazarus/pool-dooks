import { redirect } from "next/navigation";
import { db, sessions, answers, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { getPlugin } from "@/lib/games/registry";
import { buttonVariants } from "@/components/ui/button";
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

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <RevealComponent {...result} />
      <div className="flex justify-center mt-8 gap-3">
        <Link href="/home" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          🏠 Home
        </Link>
        <Link href="/sessions/new" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          Play Again
        </Link>
      </div>
    </div>
  );
}
