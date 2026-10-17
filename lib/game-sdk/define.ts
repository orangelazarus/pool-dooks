// Turns a GameDefinition into the GamePlugin the session engine consumes. All
// request handling for SDK games goes through runAction below — the one place
// that authenticates, authorizes and validates before game code runs.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, sessions } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import type { GamePlugin } from "@/lib/games/types";
import { buildContentContext, buildSessionContext } from "./context";
import { claimDueDeadline, getContent, getDeadline } from "./storage";
import { GameError } from "./errors";
import { checkContentAuth, checkSessionAccess, parseInput, type Refusal } from "./checks";
import { runInTransaction } from "./tx";
import type { ContentAction, GameDefinition, SessionAction } from "./types";

const GAME_TYPE = /^[a-z][a-z0-9_]*$/;
const SHARE_CODE = /^[A-Z0-9]{6}$/;

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...extra }, { status });

const refuse = (refusal: Refusal) => fail(refusal.status, refusal.error, refusal.extra);

/** Reads and validates an action's input: the JSON body, or the query string for GET. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readInput(req: NextRequest, action: ContentAction<any, any> | SessionAction<any, any, any>) {
  if (!action.input) return { ok: true as const, value: undefined };
  let raw: unknown;
  if (req.method === "GET") {
    raw = Object.fromEntries(req.nextUrl.searchParams);
  } else {
    try {
      raw = await req.json();
    } catch {
      return { ok: false as const, response: fail(400, "Invalid JSON body") };
    }
  }
  const parsed = parseInput(action, raw);
  return parsed.ok ? { ok: true as const, value: parsed.value } : { ok: false as const, response: refuse(parsed.refusal) };
}

async function runAction<C, S>(def: GameDefinition<C, S>, req: NextRequest, path: string[]): Promise<NextResponse> {
  try {
    const [area, a, b, ...rest] = path;

    // /api/games/<gameType>/content/<action>
    if (area === "content" && a && !b) {
      const action = Object.hasOwn(def.contentActions ?? {}, a) ? def.contentActions![a] : undefined;
      if (!action || (action.method ?? "POST") !== req.method) return fail(404, "Not found");

      const ctx = await buildContentContext<C>(def.gameType);
      const refused = checkContentAuth(action, ctx.viewer);
      if (refused) return refuse(refused);

      const input = await readInput(req, action);
      if (!input.ok) return input.response;
      return NextResponse.json((await action.handler(ctx, input.value)) ?? { ok: true });
    }

    // /api/games/<gameType>/sessions/<shareCode>/<action>
    if (area === "sessions" && a && b && rest.length === 0) {
      const isDeadline = b === DEADLINE_ACTION && !!def.onDeadline && req.method === "POST";
      const action = Object.hasOwn(def.sessionActions ?? {}, b) ? def.sessionActions![b] : undefined;
      if (!isDeadline && (!action || (action.method ?? "POST") !== req.method)) return fail(404, "Not found");
      if (!SHARE_CODE.test(a)) return fail(404, "Session not found");

      let [row] = await db.select().from(sessions).where(eq(sessions.shareCode, a));
      // A session of another game is "not found" here, not "forbidden".
      if (!row || row.gameType !== def.gameType) return fail(404, "Session not found");

      // An overdue deadline is settled before anything else sees the session.
      const fired = await fireDueDeadline(def, row);
      if (fired) row = fired;

      if (isDeadline) {
        // A browser whose countdown reached zero. Anyone who may see the game may nudge it.
        const ctx = await buildSessionContext<C, S>(def.gameType, row);
        if (!ctx.role) return fail(403, "This game is private");
        const deadline = await ctx.deadline.get();
        return NextResponse.json({
          fired: !!fired,
          deadline: deadline && { at: deadline.at.toISOString(), key: deadline.key },
          serverNow: new Date().toISOString(),
        });
      }
      if (!action) return fail(404, "Not found");

      const ctx = await buildSessionContext<C, S>(def.gameType, row);
      const refused = checkSessionAccess(action, ctx, ctx.session);
      if (refused) return refuse(refused);

      const input = await readInput(req, action);
      if (!input.ok) return input.response;
      // All of the handler's writes commit together; realtime and push go out after.
      const result = await runInTransaction(() => action.handler(ctx, input.value));
      return NextResponse.json(result ?? { ok: true });
    }

    return fail(404, "Not found");
  } catch (err) {
    if (err instanceof GameError) return fail(err.status, err.message, err.extra);
    console.error(`[game:${def.gameType}]`, err);
    return fail(500, "Something went wrong");
  }
}

/** The route a browser calls when its countdown runs out. Game action names may not start with "_". */
const DEADLINE_ACTION = "_deadline";

/**
 * Runs the game's onDeadline if the session's deadline has passed. Returns the
 * session as it is afterwards, or null if there was nothing due.
 */
async function fireDueDeadline<C, S>(def: GameDefinition<C, S>, row: Session): Promise<Session | null> {
  if (!def.onDeadline || row.status !== "in_progress" || !row.deadlineAt || row.deadlineAt > new Date()) return null;
  const fired = await runInTransaction(async () => {
    const key = await claimDueDeadline(row.id, new Date());
    if (key === null) return false; // Someone else got there first.
    const ctx = await buildSessionContext<C, S>(def.gameType, row);
    await ctx.deadline.clear(); // Tells open browsers the countdown is over.
    await def.onDeadline!(ctx, key);
    return true;
  }).catch((err) => {
    // A GameError from onDeadline is the game declining; the claim stands either way.
    if (err instanceof GameError) return true;
    throw err;
  });
  if (!fired) return null;
  const [after] = await db.select().from(sessions).where(eq(sessions.id, row.id));
  return after ?? null;
}

/**
 * Declares a game. This is the whole of a game's contract with core: what it
 * is, how a session of it runs, and the actions its client can call.
 */
export function defineGame<C = unknown, S = unknown>(def: GameDefinition<C, S>): GamePlugin & { definition: GameDefinition<C, S> } {
  if (!GAME_TYPE.test(def.gameType)) {
    throw new Error(`Invalid gameType "${def.gameType}": use lowercase letters, digits and underscores`);
  }
  for (const name of Object.keys(def.sessionActions ?? {})) {
    if (name.startsWith("_")) throw new Error(`${def.gameType}: session action "${name}" — names starting with "_" are core's`);
  }
  if (def.timer) {
    if (!def.onDeadline) throw new Error(`${def.gameType}: a game with a timer must define onDeadline`);
    if (def.timer.options.length === 0 || def.timer.options.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new Error(`${def.gameType}: timer.options must be positive whole seconds`);
    }
  }
  const ctxFor = (session: Session) => buildSessionContext<C, S>(def.gameType, session);
  // Rendering a page settles an overdue deadline first, so nobody is shown a phase that has already ended.
  const settled = async (session: Session) => (await fireDueDeadline(def, session)) ?? session;

  return {
    gameType: def.gameType,
    displayName: def.displayName,
    description: def.description,
    browsePath: `/games/${def.gameType}`,
    minPlayers: def.minPlayers,
    maxPlayers: def.maxPlayers,
    supportsRandomize: def.supportsRandomize ?? false,
    timer: def.timer ? { options: [...def.timer.options], label: def.timer.label ?? "Timer" } : null,
    usesDeadlines: !!def.onDeadline,
    supportsLeaving: !!def.onPlayerLeft,

    async getContentMeta(gameContentId) {
      const content = await getContent(def.gameType, gameContentId);
      if (!content) throw new Error("Game content not found");
      return { title: content.title };
    },

    async start(session, randomize) {
      const ctx = await ctxFor(session);
      const started = (await def.start(ctx, { randomize })) ?? {};
      return {
        // The session engine needs a tokenOrder even from games that don't use
        // its turn model; give those one placeholder per player.
        tokenOrder: started.tokenOrder ?? ctx.session.players.map((p) => `turn_${p.id}`),
        firstPlayerId: started.firstPlayerId,
      };
    },

    async getAnswerHints(answer) {
      if (!def.getAnswerHints) return {};
      return def.getAnswerHints(await ctxFor(answer.session), {
        tokenId: answer.tokenId,
        value: answer.value,
        nextTokenId: answer.nextTokenId,
        nextPlayerId: answer.nextPlayerId,
      });
    },

    buildPlayProps: async (session) => def.buildPlayProps(await ctxFor(await settled(session))),
    buildResult: async (session) => def.buildResult(await ctxFor(await settled(session))),
    async playerLeft(session, playerId, reason) {
      if (!def.onPlayerLeft) throw new Error(`${def.gameType} can't be left mid-game`);
      const ctx = await ctxFor(session);
      await def.onPlayerLeft(ctx, { playerId, reason });
      if (ctx.session.players.length === 0) await ctx.finish();
    },
    async getDeadline(session) {
      if (!def.onDeadline) return null;
      const deadline = await getDeadline(session.id);
      return deadline && { at: deadline.at.toISOString(), key: deadline.key };
    },
    getLobbyMeta: def.getLobbyMeta ? async (session) => def.getLobbyMeta!(await ctxFor(session)) : undefined,

    handleRequest: (req, path) => runAction(def, req, path),
    // For the test harness (lib/game-sdk/testing), which runs the game without HTTP or a database.
    definition: def,

    PlayComponent: def.PlayComponent,
    RevealComponent: def.RevealComponent,
    BrowsePage: def.BrowsePage,
    CreatePage: def.CreatePage,
    LibraryPage: def.LibraryPage,
  };
}
