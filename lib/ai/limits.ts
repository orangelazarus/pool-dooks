// What core allows games to spend on AI, and the arithmetic behind it. Pure:
// the service (./service) and the test harness share it. Changing a number
// here is the whole of changing a limit.
import { z } from "zod";
import type { AiRequest, AiUse } from "@/lib/game-sdk/types";

export const LIMITS = {
  /** Calls a signed-up account may make per UTC day, across all games. */
  userCallsPerDay: 20,
  /** Calls from one IP address per day, however many accounts it uses. */
  ipCallsPerDay: 40,
  /** An account younger than newAccountHours gets this many instead. */
  newAccountCallsPerDay: 3,
  newAccountHours: 24,
  /** Estimated spend per game, and for the whole site, per UTC day. Micro-dollars. */
  gameMicrosPerDay: 2_000_000,
  siteMicrosPerDay: 5_000_000,
  /** A call still marked in flight after this is treated as dead (it still counts as a call). */
  inFlightMs: 2 * 60_000,

  // Ceilings on what a game may declare for one use.
  maxInputChars: 20_000,
  maxOutputTokens: 4096,
  /** Base64 characters: about 5 MB of image. */
  maxImageChars: 7_000_000,
} as const;

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

/** Why core turned a call down. Each maps to a status and a message players see. */
export type RefusalReason =
  | "blocked"
  | "in_flight"
  | "use_daily"
  | "user_daily"
  | "new_account"
  | "ip_daily"
  | "game_budget"
  | "site_budget";

export const REFUSALS: Record<RefusalReason, { status: number; message: string }> = {
  blocked: { status: 503, message: "AI features are switched off right now." },
  in_flight: { status: 429, message: "Your last AI request is still running. Wait for it to finish." },
  use_daily: { status: 429, message: "You've used this AI feature as much as you can today. Try again tomorrow." },
  user_daily: { status: 429, message: "You've used your AI allowance for today. Try again tomorrow." },
  new_account: { status: 429, message: "New accounts get a few AI requests a day for the first day. Try again tomorrow." },
  ip_daily: { status: 429, message: "Too many AI requests from your network today. Try again tomorrow." },
  game_budget: { status: 503, message: "This game's AI features have hit their limit for today. Try again tomorrow." },
  site_budget: { status: 503, message: "AI features have hit their limit for today. Try again tomorrow." },
};

/** Today's usage, from the ledger, as it bears on one call. */
export interface Tally {
  /** This user's calls to this game's use. */
  useCalls: number;
  userCalls: number;
  ipCalls: number;
  gameMicros: number;
  siteMicros: number;
  /** This user's calls still running. */
  inFlight: number;
}

export interface Caller {
  perUserPerDay: number;
  /** Hours since the account was made. */
  accountAgeHours: number;
}

const userAllowance = (caller: Caller) =>
  caller.accountAgeHours < LIMITS.newAccountHours ? LIMITS.newAccountCallsPerDay : LIMITS.userCallsPerDay;

/** The first limit this call would break, or null if it may go ahead. Spend caps first: they apply to everyone. */
export function refusalFor(t: Tally, caller: Caller): RefusalReason | null {
  if (t.siteMicros >= LIMITS.siteMicrosPerDay) return "site_budget";
  if (t.gameMicros >= LIMITS.gameMicrosPerDay) return "game_budget";
  if (t.inFlight > 0) return "in_flight";
  if (t.ipCalls >= LIMITS.ipCallsPerDay) return "ip_daily";
  if (t.userCalls >= userAllowance(caller)) {
    return caller.accountAgeHours < LIMITS.newAccountHours ? "new_account" : "user_daily";
  }
  if (t.useCalls >= caller.perUserPerDay) return "use_daily";
  return null;
}

/** Calls this user has left today for one use: 0 when any cap is spent. */
export function remaining(t: Tally, caller: Caller): number {
  if (t.siteMicros >= LIMITS.siteMicrosPerDay || t.gameMicros >= LIMITS.gameMicrosPerDay) return 0;
  return Math.max(
    0,
    Math.min(LIMITS.ipCallsPerDay - t.ipCalls, userAllowance(caller) - t.userCalls, caller.perUserPerDay - t.useCalls)
  );
}

/** Why a declared use is invalid, or null. defineGame throws on these, so a bad declaration never ships. */
export function checkAiUse(name: string, use: AiUse): string | null {
  if (use.tier !== "fast" && use.tier !== "smart") return `ai.${name}: tier must be "fast" or "smart"`;
  const whole = (n: number, max: number) => Number.isInteger(n) && n > 0 && n <= max;
  if (!whole(use.maxInputChars, LIMITS.maxInputChars)) return `ai.${name}: maxInputChars must be 1–${LIMITS.maxInputChars}`;
  if (!whole(use.maxOutputTokens, LIMITS.maxOutputTokens)) return `ai.${name}: maxOutputTokens must be 1–${LIMITS.maxOutputTokens}`;
  if (!whole(use.perUserPerDay, LIMITS.userCallsPerDay)) return `ai.${name}: perUserPerDay must be 1–${LIMITS.userCallsPerDay}`;
  let schema: { type?: unknown };
  try {
    schema = z.toJSONSchema(use.output) as { type?: unknown };
  } catch {
    return `ai.${name}: output must be a plain zod object schema`;
  }
  if (schema.type !== "object") return `ai.${name}: output must be a zod object`;
  return null;
}

/** Why a request doesn't fit its declared use, or null. */
export function checkAiRequest(use: AiUse, request: AiRequest): string | null {
  const parts = typeof request.input === "string" ? [{ type: "text" as const, text: request.input }] : request.input;
  if (parts.length === 0) return "Nothing to send";
  let chars = 0;
  let images = 0;
  for (const part of parts) {
    if (part.type === "text") chars += part.text.length;
    else if (part.type === "image") {
      images++;
      if (!use.images) return "This feature doesn't take images";
      if (!(IMAGE_TYPES as readonly string[]).includes(part.mediaType)) return "Unsupported image type. Use JPG, PNG, GIF, or WebP.";
      if (part.data.length > LIMITS.maxImageChars) return "That image is too large — use one under 5 MB.";
    } else return "Unknown input part";
  }
  if (images > 1) return "Send one image at a time";
  if (chars > use.maxInputChars) return `That's too long — keep it under ${use.maxInputChars.toLocaleString("en-US")} characters.`;
  return null;
}
