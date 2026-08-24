import { getPlugin } from "@/lib/games/registry";
import { notFound } from "next/navigation";

export default async function GameCreatePage({
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

  if (!plugin.CreatePage) notFound();

  const { CreatePage } = plugin;
  return <CreatePage />;
}
