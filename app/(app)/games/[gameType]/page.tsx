import { getPlugin } from "@/lib/games/registry";
import { notFound } from "next/navigation";

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

  const { BrowsePage } = plugin;
  return <BrowsePage searchParams={searchParams} />;
}
