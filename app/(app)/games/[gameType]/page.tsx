import { getPlugin } from "@/lib/games/registry";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { listFinishedSessions } from "@/lib/sessions/history";
import { RecentGames } from "@/components/session/RecentGames";

export const dynamic = "force-dynamic";

export default async function GameBrowsePage({
  params,
  searchParams,
}: {
  params: Promise<{ gameType: string }>;
  searchParams?: Promise<Record<string, string>>;
}) {
  const { gameType } = await params;

  let plugin;
  try {
    plugin = getPlugin(gameType);
  } catch {
    notFound();
  }

  const { data: { user } } = await (await createClient()).auth.getUser();
  const finished = await listFinishedSessions(gameType, user?.id ?? null);

  const { BrowsePage } = plugin;
  return (
    <>
      <BrowsePage searchParams={searchParams} />
      {/* Every game gets its finished games listed, without any code of its own. */}
      <RecentGames gameType={gameType} games={finished} />
    </>
  );
}
