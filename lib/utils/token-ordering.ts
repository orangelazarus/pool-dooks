import type { PoolDookToken } from "@/lib/db/schema";

export function resolveTokenOrder(
  tokens: PoolDookToken[],
  randomize: boolean
): string[] {
  const ids = tokens.map((t) => t.id);
  if (!randomize) return ids;

  // Fisher-Yates shuffle
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
