import { getPlugin } from "@/lib/games/registry";
import { notFound } from "next/navigation";

export default async function GameLibraryPage({
  params,
}: {
  params: Promise<{ gameType: string }>;
}) {
  const { gameType } = await params;

  let plugin;
  try {
    plugin = getPlugin(gameType);
  } catch {
    notFound();
  }

  if (!plugin.LibraryPage) notFound();

  const { LibraryPage } = plugin;
  return <LibraryPage />;
}
