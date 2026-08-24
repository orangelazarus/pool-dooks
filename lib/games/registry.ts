import type { GamePlugin } from "./types";
import { poolDooksPlugin } from "./pool-dooks/plugin";
import { guessTheNumberPlugin } from "./guess-the-number/plugin";

const registry = new Map<string, GamePlugin>([
  ["pool_dooks", poolDooksPlugin],
  ["guess_the_number", guessTheNumberPlugin],
]);

export function getPlugin(gameType: string): GamePlugin {
  const plugin = registry.get(gameType);
  if (!plugin) throw new Error(`Unknown game type: ${gameType}`);
  return plugin;
}

export function listPlugins(): GamePlugin[] {
  return Array.from(registry.values());
}
