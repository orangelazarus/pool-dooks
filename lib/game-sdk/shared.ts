// Small helpers every game ends up wanting. Pure, with no imports, so a game's
// rules (server) and components (browser) can both use them.

/** A shuffled copy; the input is left alone. */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** One item at random. Throws on an empty list rather than returning undefined. */
export function pickOne<T>(items: readonly T[]): T {
  if (items.length === 0) throw new Error("pickOne: nothing to pick from");
  return items[Math.floor(Math.random() * items.length)];
}

/** Up to `count` different items at random. */
export function pickSome<T>(items: readonly T[], count: number): T[] {
  return shuffle(items).slice(0, count);
}
