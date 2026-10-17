import type { z } from "zod";
import { defineGame, GameError, type SessionContext } from "@/lib/game-sdk";
import { CreateSchema, DrawSchema, MoveSchema, type ChessContent, type ChessState } from "./schema";
import { remainingMs, timeControlLabel, type Side } from "./clock";
import {
  replay,
  sideToMove,
  otherSide,
  detectEnd,
  resolveColors,
  type ChessStatePayload,
  type GameResult,
  type ResultReason,
} from "./engine";
import { ChessBoard } from "./components/ChessBoard";
import { ChessReveal } from "./components/ChessReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<ChessContent, ChessState>;

const toMoveOf = (state: ChessState): Side => (state.moves.length % 2 === 0 ? "white" : "black");
const playerId = (state: ChessState, side: Side) => (side === "white" ? state.whitePlayerId : state.blackPlayerId);

function toPayload(state: ChessState, now: number): ChessStatePayload {
  return {
    moves: state.moves,
    whitePlayerId: state.whitePlayerId,
    blackPlayerId: state.blackPlayerId,
    currentPlayerId: playerId(state, toMoveOf(state)),
    whiteMs: state.whiteMs,
    blackMs: state.blackMs,
    turnStartedAt: state.turnStartedAt,
    serverNow: now,
    drawOfferedBy: state.drawOfferedBy,
    result: state.result,
    resultReason: state.resultReason,
  };
}

/** The live game and the caller's side in it. Core has already checked they're a player of a game in progress. */
async function loadGame(ctx: Ctx) {
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Game state missing");
  if (stored.data.result) throw new GameError(400, "Game is already over");

  const state = stored.data;
  const side: Side | null =
    state.whitePlayerId === ctx.viewer!.id ? "white" : state.blackPlayerId === ctx.viewer!.id ? "black" : null;
  if (!side) throw new GameError(403, "Not a player in this game");
  return { state, version: stored.version, side };
}

/** Writes a change to the game and tells everyone watching. A lost race is a 409 from core. */
async function save(ctx: Ctx, state: ChessState, version: number): Promise<ChessStatePayload> {
  const saved = await ctx.state.update(state, { expectedVersion: version });
  const payload = toPayload(saved.data, Date.now());
  await ctx.broadcast("state", payload);
  return payload;
}

/** Ends the game with a result. */
async function finishGame(
  ctx: Ctx,
  state: ChessState,
  version: number,
  result: GameResult,
  reason: ResultReason
): Promise<ChessStatePayload> {
  const payload = await save(
    ctx,
    { ...state, result, resultReason: reason, drawOfferedBy: null, turnStartedAt: null },
    version
  );
  await ctx.finish();
  return payload;
}

export const plugin = defineGame<ChessContent, ChessState>({
  gameType: "chess",
  displayName: "Chess",
  description: "The classic two-player game — untimed or against the clock",
  minPlayers: 2,
  maxPlayers: 2,

  async getLobbyMeta(ctx) {
    const { hostColor, timeControlSeconds } = ctx.session.content.data;
    const colors = hostColor === "random" ? "Random colors" : `Host plays ${hostColor}`;
    return { subtitle: `${colors} · ${timeControlLabel(timeControlSeconds)}` };
  },

  async start(ctx) {
    const { hostColor, timeControlSeconds } = ctx.session.content.data;
    const guest = ctx.session.players.find((p) => p.id !== ctx.session.hostId);
    if (!guest) throw new GameError(400, "Chess needs two players");

    const startMs = timeControlSeconds === null ? null : timeControlSeconds * 1000;
    // init() keeps an existing state, so read back what is actually stored:
    // if the game was somehow started twice, the first colors win.
    const { data: state } = await ctx.state.init({
      ...resolveColors(hostColor, ctx.session.hostId, guest.id),
      moves: [],
      whiteMs: startMs,
      blackMs: startMs,
      turnStartedAt: null,
      drawOfferedBy: null,
      result: null,
      resultReason: null,
    });
    return { firstPlayerId: state.whitePlayerId };
  },

  async buildPlayProps(ctx) {
    const stored = await ctx.state.get();
    if (!stored) throw new GameError(500, "Chess game state not found");
    return {
      title: ctx.session.content.title,
      timeControlSeconds: ctx.session.content.data.timeControlSeconds,
      initialState: toPayload(stored.data, Date.now()),
    };
  },

  // Walking out of a game of chess loses it.
  async onPlayerLeft(ctx, { playerId: leaverId }) {
    const stored = await ctx.state.get();
    if (!stored || stored.data.result) return;
    const state = stored.data;
    const leaverSide: Side = state.whitePlayerId === leaverId ? "white" : "black";
    await finishGame(ctx, state, stored.version, otherSide(leaverSide), "forfeit");
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyone = [...ctx.session.players, ...ctx.session.leftPlayers];
    const nameOf = (id?: string) => everyone.find((p) => p.id === id)?.username ?? "Unknown";
    return {
      title: ctx.session.content.title,
      timeControlSeconds: ctx.session.content.data.timeControlSeconds,
      white: nameOf(state?.whitePlayerId),
      black: nameOf(state?.blackPlayerId),
      moves: state?.moves ?? [],
      result: state?.result ?? null,
      resultReason: state?.resultReason ?? null,
    };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      handler: async (ctx) =>
        (await ctx.content.list({ limit: 20 })).map((game) => ({
          id: game.id,
          title: game.title,
          hostColor: game.data.hostColor,
          timeControlSeconds: game.data.timeControlSeconds,
          createdAt: game.createdAt,
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, input: z.infer<typeof CreateSchema>) => {
        const { hostColor, timeControlSeconds } = input;
        const game = await ctx.content.create({
          title: input.title?.trim() || `Chess — ${timeControlLabel(timeControlSeconds)}`,
          data: { hostColor, timeControlSeconds },
        });
        return { id: game.id, title: game.title };
      },
    },
  },

  sessionActions: {
    move: {
      access: "player",
      input: MoveSchema,
      handler: async (ctx, input: z.infer<typeof MoveSchema>) => {
        const { state, version, side } = await loadGame(ctx);

        const chess = replay(state.moves);
        const toMove = sideToMove(chess);
        if (side !== toMove) throw new GameError(403, "Not your turn");

        const now = Date.now();
        const timeLeft = remainingMs(state, side, toMove, now);
        if (timeLeft !== null && timeLeft <= 0) {
          const flagged = { ...state, [side === "white" ? "whiteMs" : "blackMs"]: 0 };
          const payload = await finishGame(ctx, flagged, version, otherSide(side), "timeout");
          throw new GameError(409, "You ran out of time", { state: payload });
        }

        try {
          chess.move(input);
        } catch {
          throw new GameError(400, "Illegal move");
        }

        const moves = chess.history();
        const next: ChessState = {
          ...state,
          moves,
          // An offer stands until the opponent answers it or moves — so moving
          // clears the opponent's offer, but not one you made yourself.
          drawOfferedBy: state.drawOfferedBy === ctx.viewer!.id ? state.drawOfferedBy : null,
        };
        if (timeLeft !== null) {
          next[side === "white" ? "whiteMs" : "blackMs"] = timeLeft;
          next.turnStartedAt = now;
        }

        const end = detectEnd(chess);
        if (end) return finishGame(ctx, next, version, end.result, end.reason);

        const payload = await save(ctx, next, version);
        const nextId = playerId(next, otherSide(side));
        await ctx.turn.set(nextId);
        await ctx.notify(nextId, { title: "Your move!", body: `${moves[moves.length - 1]} was played.` });
        return payload;
      },
    },

    resign: {
      access: "player",
      handler: async (ctx) => {
        const { state, version, side } = await loadGame(ctx);
        return finishGame(ctx, state, version, otherSide(side), "resignation");
      },
    },

    draw: {
      access: "player",
      input: DrawSchema,
      handler: async (ctx, { action }: z.infer<typeof DrawSchema>) => {
        const { state, version, side } = await loadGame(ctx);
        const me = ctx.viewer!.id;
        const opponentId = playerId(state, otherSide(side));
        const opponentOffered = state.drawOfferedBy === opponentId;

        // Offering back while the opponent's offer is open is the same as accepting.
        if (action === "accept" || (action === "offer" && opponentOffered)) {
          if (!opponentOffered) throw new GameError(400, "No draw offer to accept");
          return finishGame(ctx, state, version, "draw", "agreement");
        }
        if (action === "decline" && !opponentOffered) throw new GameError(400, "No draw offer to decline");
        if (action === "offer" && state.drawOfferedBy === me) throw new GameError(400, "You already offered a draw");

        const payload = await save(ctx, { ...state, drawOfferedBy: action === "offer" ? me : null }, version);
        if (action === "offer") {
          await ctx.notify(opponentId, { title: "Draw offered", body: "Your opponent offered a draw." });
        }
        return payload;
      },
    },

    /** Either player reports that the clock of the side to move has run out. */
    flag: {
      access: "player",
      handler: async (ctx) => {
        const { state, version } = await loadGame(ctx);
        const toMove = toMoveOf(state);
        const timeLeft = remainingMs(state, toMove, toMove, Date.now());
        if (timeLeft === null || timeLeft > 0) {
          throw new GameError(400, "The clock hasn't run out", { state: toPayload(state, Date.now()) });
        }
        const flagged = { ...state, [toMove === "white" ? "whiteMs" : "blackMs"]: 0 };
        return finishGame(ctx, flagged, version, otherSide(toMove), "timeout");
      },
    },

    /** The current position — for a browser catching up after being in the background. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => {
        const stored = await ctx.state.get();
        if (!stored) throw new GameError(404, "Game state missing");
        return toPayload(stored.data, Date.now());
      },
    },
  },

  PlayComponent: ChessBoard,
  RevealComponent: ChessReveal,
  BrowsePage,
});
