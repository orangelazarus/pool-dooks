// Which model each tier uses, and what it costs. Games name a tier, never a
// model, so swapping models or prices is a change here alone.
export const MODELS = {
  fast: "claude-haiku-4-5-20251001",
  smart: "claude-sonnet-4-6",
} as const;

// Dollars per million tokens, from anthropic.com/pricing. Images are billed as input tokens.
const PRICES: Record<string, { input: number; output: number }> = {
  [MODELS.fast]: { input: 1, output: 5 },
  [MODELS.smart]: { input: 3, output: 15 },
};

/** Estimated cost of one call, in millionths of a dollar. Rounded up, so the ledger never under-counts. */
export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? PRICES[MODELS.smart];
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}
