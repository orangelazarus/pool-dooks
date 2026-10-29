// The one place a model is called. Games reach it through ctx.ai (built in
// lib/game-sdk/context.ts); every call is checked against the game's declared
// use and core's daily limits, and written to the ai_usage ledger.
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { aiBlocks, aiUsage, db } from "@/lib/db";
import { GameError } from "@/lib/game-sdk/errors";
import type { AiRequest, AiUse, Viewer } from "@/lib/game-sdk/types";
import { LIMITS, REFUSALS, checkAiRequest, refusalFor, remaining, type Caller, type RefusalReason, type Tally } from "./limits";
import { MODELS, costMicros } from "./models";

const anthropic = new Anthropic({ maxRetries: 2 });

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

/** Who is asking, as far as limits go. */
export interface AiCaller {
  viewer: Viewer | null;
  /** When the account became a signed-up one; null for guests and logged-out viewers. */
  accountSince: Date | null;
  /** The client's address, from Caddy's X-Forwarded-For. */
  ip: string;
}

/** The declared output as a tool's input schema. */
function inputSchema(output: z.ZodType): Anthropic.Tool.InputSchema {
  const schema = z.toJSONSchema(output) as Record<string, unknown>;
  delete schema.$schema;
  return schema as Anthropic.Tool.InputSchema;
}

const hashIp = (ip: string) => createHash("sha256").update(`pooldooks-ai:${ip}`).digest("hex").slice(0, 32);
const startOfUtcDay = () => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};
const ageHours = (since: Date | null) => (since ? (Date.now() - since.getTime()) / 3_600_000 : 0);

/** Whether an off switch covers this game or user. */
async function isBlocked(gameType: string, userId: string | null): Promise<boolean> {
  const scopes = ["all", `game:${gameType}`, ...(userId ? [`user:${userId}`] : [])];
  const rows = await db.select({ scope: aiBlocks.scope }).from(aiBlocks).where(inArray(aiBlocks.scope, scopes));
  return rows.length > 0;
}

const NOT_REFUSED = sql`${aiUsage.outcome} not like 'refused:%'`;

async function tally(tx: Pick<typeof db, "select">, gameType: string, use: string, userId: string, ipHash: string): Promise<Tally> {
  const inFlightSince = new Date(Date.now() - LIMITS.inFlightMs);
  const [row] = await tx
    .select({
      useCalls: sql<number>`count(*) filter (where ${aiUsage.userId} = ${userId} and ${aiUsage.gameType} = ${gameType} and ${aiUsage.use} = ${use} and ${NOT_REFUSED})`,
      userCalls: sql<number>`count(*) filter (where ${aiUsage.userId} = ${userId} and ${NOT_REFUSED})`,
      ipCalls: sql<number>`count(*) filter (where ${aiUsage.ipHash} = ${ipHash} and ${NOT_REFUSED})`,
      gameMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}) filter (where ${aiUsage.gameType} = ${gameType}), 0)`,
      siteMicros: sql<number>`coalesce(sum(${aiUsage.costMicros}), 0)`,
      inFlight: sql<number>`count(*) filter (where ${aiUsage.userId} = ${userId} and ${aiUsage.outcome} = 'pending' and ${aiUsage.createdAt} > ${inFlightSince})`,
    })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, startOfUtcDay()));
  // Postgres returns counts and sums as strings.
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, Number(v)])) as unknown as Tally;
}

function refuse(reason: RefusalReason): never {
  throw new GameError(REFUSALS[reason].status, REFUSALS[reason].message);
}

/** Who may call AI at all: a signed-up account, on a server with a key. */
function admit(caller: AiCaller): Viewer {
  if (!aiConfigured()) throw new GameError(503, "AI features aren't set up on this server");
  if (!caller.viewer) throw new GameError(401, "Unauthorized");
  if (caller.viewer.isGuest) throw new GameError(403, "Create an account to use AI features");
  return caller.viewer;
}

/**
 * Reserves a call: under one lock per user, checks the off switches and
 * limits, then records the call as pending. Returns the ledger row's id.
 */
async function reserve(gameType: string, name: string, use: AiUse, viewer: Viewer, caller: AiCaller): Promise<string> {
  const ipHash = hashIp(caller.ip);
  const outcome = await db.transaction(async (tx) => {
    // One reservation at a time per user, so two tabs can't both slip under a limit.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ai:${viewer.id}`}))`);
    let reason: RefusalReason | null = (await isBlocked(gameType, viewer.id)) ? "blocked" : null;
    if (!reason) {
      const t = await tally(tx, gameType, name, viewer.id, ipHash);
      reason = refusalFor(t, { perUserPerDay: use.perUserPerDay, accountAgeHours: ageHours(caller.accountSince) });
    }
    if (reason) {
      // Logged at most once per user, reason and hour: a script hammering a limit can't grow the table.
      const hourAgo = new Date(Date.now() - 3_600_000);
      const [seen] = await tx
        .select({ id: aiUsage.id })
        .from(aiUsage)
        .where(and(eq(aiUsage.userId, viewer.id), eq(aiUsage.outcome, `refused:${reason}`), gte(aiUsage.createdAt, hourAgo)))
        .limit(1);
      if (!seen) {
        await tx.insert(aiUsage).values({ userId: viewer.id, ipHash, gameType, use: name, outcome: `refused:${reason}` });
      }
      return { refused: reason, id: null } as const;
    }
    const [row] = await tx
      .insert(aiUsage)
      .values({ userId: viewer.id, ipHash, gameType, use: name, model: MODELS[use.tier], outcome: "pending" })
      .returning({ id: aiUsage.id });
    return { refused: null, id: row.id } as const;
  });
  if (outcome.refused) refuse(outcome.refused);
  return outcome.id!;
}

/** Runs one declared AI use for a content action and returns its parsed output. */
export async function runAi<T>(gameType: string, name: string, use: AiUse<T> | undefined, request: AiRequest, caller: AiCaller): Promise<T> {
  // A game calling a use it never declared is a bug in the game, not the player's doing.
  if (!use) throw new Error(`${gameType}: ctx.ai.run("${name}") — no such use in defineGame({ ai })`);
  const viewer = admit(caller);
  const invalid = checkAiRequest(use, request);
  if (invalid) throw new GameError(400, invalid);

  const id = await reserve(gameType, name, use, viewer, caller);
  const model = MODELS[use.tier];
  const content: Anthropic.ContentBlockParam[] = (typeof request.input === "string" ? [{ type: "text" as const, text: request.input }] : request.input).map(
    (part) =>
      part.type === "text"
        ? { type: "text" as const, text: part.text }
        : {
            type: "image" as const,
            source: { type: "base64" as const, media_type: part.mediaType as "image/jpeg", data: part.data },
          }
  );

  let message: Anthropic.Message;
  try {
    // The reply must be the declared shape: one forced tool call whose input is the output.
    message = await anthropic.messages.create({
      model,
      max_tokens: use.maxOutputTokens,
      ...(request.system ? { system: request.system } : {}),
      messages: [{ role: "user", content }],
      tools: [
        {
          name: "respond",
          description: "Give your answer by calling this tool.",
          input_schema: inputSchema(use.output),
        },
      ],
      tool_choice: { type: "tool", name: "respond" },
    });
  } catch (err) {
    await db.update(aiUsage).set({ outcome: "error" }).where(eq(aiUsage.id, id));
    console.error(`[ai:${gameType}.${name}]`, err instanceof Error ? err.message : err);
    if (err instanceof Anthropic.APIError && (err.status === 429 || err.status === 529)) {
      throw new GameError(503, "The AI is busy. Try again in a moment.");
    }
    throw new GameError(502, "The AI request failed. Try again.");
  }

  const { input_tokens, output_tokens } = message.usage;
  const declined = message.stop_reason === "refusal";
  const call = message.content.find((block) => block.type === "tool_use");
  const parsed = call ? use.output.safeParse(call.input) : null;
  await db
    .update(aiUsage)
    .set({
      inputTokens: input_tokens,
      outputTokens: output_tokens,
      costMicros: costMicros(model, input_tokens, output_tokens),
      outcome: parsed?.success ? "ok" : "error",
    })
    .where(eq(aiUsage.id, id));

  if (declined) throw new GameError(422, "The AI declined that. Try different wording or a different image.");
  if (!parsed?.success) throw new GameError(502, "The AI's answer didn't come out right. Try again.");
  return parsed.data;
}

/** What a viewer's page needs to show or hide AI controls: per declared use, calls left today. */
export async function aiStatus(gameType: string, uses: Record<string, AiUse>, caller: AiCaller) {
  const names = Object.keys(uses);
  const none = { available: false, remaining: Object.fromEntries(names.map((n) => [n, 0])) };
  if (names.length === 0 || !aiConfigured() || !caller.viewer || caller.viewer.isGuest) return none;
  if (await isBlocked(gameType, caller.viewer.id)) return none;
  const ipHash = hashIp(caller.ip);
  const left: Record<string, number> = {};
  for (const name of names) {
    const t = await tally(db, gameType, name, caller.viewer.id, ipHash);
    const who: Caller = { perUserPerDay: uses[name].perUserPerDay, accountAgeHours: ageHours(caller.accountSince) };
    left[name] = remaining(t, who);
  }
  return { available: true, remaining: left };
}
