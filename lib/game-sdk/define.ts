// Turns a GameDefinition into the GamePlugin the session engine consumes. All
// request handling for SDK games goes through runAction below — the one place
// that authenticates, authorizes and validates before game code runs.
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, sessions } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import type { GamePlugin } from "@/lib/games/types";
import { buildContentContext, buildSessionContext } from "./context";
import { getContent } from "./storage";
import { GameError } from "./errors";
import { runInTransaction } from "./tx";
import type { ContentAction, GameDefinition, SessionAction } from "./types";

const GAME_TYPE = /^[a-z][a-z0-9_]*$/;
const SHARE_CODE = /^[A-Z0-9]{6}$/;

const fail = (status: number, error: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...extra }, { status });

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
  const parsed = action.input.safeParse(raw);
  if (!parsed.success) return { ok: false as const, response: fail(400, "Invalid input", { details: parsed.error.flatten() }) };
  return { ok: true as const, value: parsed.data };
}

async function runAction<C, S>(def: GameDefinition<C, S>, req: NextRequest, path: string[]): Promise<NextResponse> {
  try {
    const [area, a, b, ...rest] = path;

    // /api/games/<gameType>/content/<action>
    if (area === "content" && a && !b) {
      const action = Object.hasOwn(def.contentActions ?? {}, a) ? def.contentActions![a] : undefined;
      if (!action || (action.method ?? "POST") !== req.method) return fail(404, "Not found");

      const ctx = await buildContentContext<C>(def.gameType);
      if (action.auth !== "public" && !ctx.viewer) return fail(401, "Unauthorized");
      if (action.auth === "account" && ctx.viewer!.isGuest) return fail(403, "Create an account to do this");

      const input = await readInput(req, action);
      if (!input.ok) return input.response;
      return NextResponse.json((await action.handler(ctx, input.value)) ?? { ok: true });
    }

    // /api/games/<gameType>/sessions/<shareCode>/<action>
    if (area === "sessions" && a && b && rest.length === 0) {
      const action = Object.hasOwn(def.sessionActions ?? {}, b) ? def.sessionActions![b] : undefined;
      if (!action || (action.method ?? "POST") !== req.method) return fail(404, "Not found");
      if (!SHARE_CODE.test(a)) return fail(404, "Session not found");

      const [row] = await db.select().from(sessions).where(eq(sessions.shareCode, a));
      // A session of another game is "not found" here, not "forbidden".
      if (!row || row.gameType !== def.gameType) return fail(404, "Session not found");

      const ctx = await buildSessionContext<C, S>(def.gameType, row);
      if (action.access === "player" || action.access === "host") {
        if (!ctx.viewer) return fail(401, "Unauthorized");
        if (ctx.role !== "player") return fail(403, "Not a player in this game");
        if (action.access === "host" && ctx.viewer.id !== row.hostId) return fail(403, "Only the host can do that");
      } else if (!ctx.role) {
        return fail(403, "This game is private");
      }

      const when = action.when ?? (action.access === "viewer" ? "any" : "in_progress");
      if (when === "in_progress" && row.status !== "in_progress") return fail(400, "Session not in progress");

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

/**
 * Declares a game. This is the whole of a game's contract with core: what it
 * is, how a session of it runs, and the actions its client can call.
 */
export function defineGame<C = unknown, S = unknown>(def: GameDefinition<C, S>): GamePlugin {
  if (!GAME_TYPE.test(def.gameType)) {
    throw new Error(`Invalid gameType "${def.gameType}": use lowercase letters, digits and underscores`);
  }
  const ctxFor = (session: Session) => buildSessionContext<C, S>(def.gameType, session);

  return {
    gameType: def.gameType,
    displayName: def.displayName,
    description: def.description,
    browsePath: `/games/${def.gameType}`,
    minPlayers: def.minPlayers,
    maxPlayers: def.maxPlayers,
    supportsRandomize: def.supportsRandomize ?? false,

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

    buildPlayProps: async (session) => def.buildPlayProps(await ctxFor(session)),
    buildResult: async (session) => def.buildResult(await ctxFor(session)),
    getLobbyMeta: def.getLobbyMeta ? async (session) => def.getLobbyMeta!(await ctxFor(session)) : undefined,

    handleRequest: (req, path) => runAction(def, req, path),

    PlayComponent: def.PlayComponent,
    RevealComponent: def.RevealComponent,
    BrowsePage: def.BrowsePage,
    CreatePage: def.CreatePage,
    LibraryPage: def.LibraryPage,
  };
}
