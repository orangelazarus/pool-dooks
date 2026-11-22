import type { z } from "zod";
import { Crown } from "lucide-react";
import { defineGame, GameError, type SessionContext } from "@/lib/game-sdk";
import { CreateSchema, DrawSchema, MoveSchema, type ChessContent, type ChessState } from "./schema";
import { remainingMs, timeControlLabel, type Side } from "./clock";
import { computerMove, evaluate } from "./computer";
import {
  replay,
  sideToMove,
  otherSide,
  detectEnd,
  resolveColors,
  computerName,
  COMPUTER_ID,
  type ChessStatePayload,
  type GameResult,
  type ResultReason,
} from "./engine";
import { ChessBoard } from "./components/ChessBoard";
import { ChessReveal } from "./components/ChessReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<ChessContent, ChessState>;

/** The computer's level, or null if this is a game between two players. */
const computerLevel = (content: ChessContent) =>
  content.opponent === "computer" ? (content.level ?? "medium") : null;

// The player's browser asks for the computer's reply as soon as its own move
// lands (the "computer" action). The deadline is the backstop for a browser
// that never asks — closed, offline — and for the computer's opening move.
const COMPUTER_DELAY_MS = 1500;
// If the engine fails, try again after this rather than leave the game stuck.
const COMPUTER_RETRY_MS = 3000;
const computerKey = (state: ChessState) => `computer:${state.moves.length}`;

// The computer takes a draw it's losing, or a level position deep into the game.
const DRAW_WHEN_WORSE_CP = -100;
const DRAW_WHEN_LEVEL_CP = 25;
const DRAW_WHEN_LEVEL_AFTER_PLIES = 80;

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

/**
 * The computer plays its move, if it's its turn. Null if it isn't (the game is
 * over, or someone else's request already played it).
 */
async function computerTurn(ctx: Ctx, state: ChessState, version: number): Promise<ChessStatePayload | null> {
  const level = computerLevel(ctx.session.content.data);
  if (!level || state.result) return null;
  const chess = replay(state.moves);
  const side = sideToMove(chess);
  if (playerId(state, side) !== COMPUTER_ID) return null;

  let uci: string | null;
  try {
    uci = await computerMove(chess.fen(), level);
  } catch {
    // Leave the game waiting on the computer, and try again shortly.
    await ctx.deadline.set(COMPUTER_RETRY_MS, computerKey(state));
    return null;
  }
  if (!uci) return null; // No legal move: the game would already have ended.
  return playMove(ctx, state, version, side, {
    from: uci.slice(0, 2),
    to: uci.slice(2, 4),
    promotion: uci[4] as "q" | "r" | "b" | "n" | undefined,
  });
}

/**
 * Plays `side`'s move — the player's from the move action, or the computer's
 * from computerTurn — then ends the game or passes the move on.
 */
async function playMove(
  ctx: Ctx,
  state: ChessState,
  version: number,
  side: Side,
  input: z.infer<typeof MoveSchema>
): Promise<ChessStatePayload> {
  const chess = replay(state.moves);
  const toMove = sideToMove(chess);
  const moverId = playerId(state, side);

  const now = Date.now();
  const timeLeft = remainingMs(state, side, toMove, now);
  if (timeLeft !== null && timeLeft <= 0) {
    const flagged = { ...state, [side === "white" ? "whiteMs" : "blackMs"]: 0 };
    const payload = await finishGame(ctx, flagged, version, otherSide(side), "timeout");
    if (moverId === COMPUTER_ID) return payload;
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
    drawOfferedBy: state.drawOfferedBy === moverId ? state.drawOfferedBy : null,
  };
  if (timeLeft !== null) {
    next[side === "white" ? "whiteMs" : "blackMs"] = timeLeft;
    next.turnStartedAt = now;
  }

  const end = detectEnd(chess);
  if (end) return finishGame(ctx, next, version, end.result, end.reason);

  const payload = await save(ctx, next, version);
  const nextId = playerId(next, otherSide(side));
  if (nextId === COMPUTER_ID) {
    await ctx.deadline.set(COMPUTER_DELAY_MS, computerKey(next));
  } else if (moverId === COMPUTER_ID) {
    await ctx.deadline.clear(); // The backstop isn't needed now.
  } else {
    // Against the computer the player is already watching for its reply.
    await ctx.turn.set(nextId);
    await ctx.notify(nextId, { title: "Your move!", body: `${moves[moves.length - 1]} was played.` });
  }
  return payload;
}

export const plugin = defineGame<ChessContent, ChessState>({
  gameType: "chess",
  displayName: "Chess",
  icon: Crown,
  description: "The classic game — against a friend or the computer, untimed or against the clock",
  // One is a game against the computer; a game against a friend still needs
  // two, which start() checks.
  minPlayers: 1,
  maxPlayers: 2,

  async getLobbyMeta(ctx) {
    const content = ctx.session.content.data;
    const { hostColor, timeControlSeconds } = content;
    const level = computerLevel(content);
    const colors = hostColor === "random" ? "Random colors" : `Host plays ${hostColor}`;
    return {
      subtitle: [level && `vs ${computerName(level)}`, colors, timeControlLabel(timeControlSeconds)]
        .filter(Boolean)
        .join(" · "),
    };
  },

  async start(ctx) {
    const { hostColor, timeControlSeconds } = ctx.session.content.data;
    const vsComputer = computerLevel(ctx.session.content.data) !== null;
    // Against the computer, anyone else who joined the lobby just watches.
    const opponentId = vsComputer ? COMPUTER_ID : ctx.session.players.find((p) => p.id !== ctx.session.hostId)?.id;
    if (!opponentId) throw new GameError(400, "Waiting for your opponent to join");

    const startMs = timeControlSeconds === null ? null : timeControlSeconds * 1000;
    // init() keeps an existing state, so read back what is actually stored:
    // if the game was somehow started twice, the first colors win.
    const { data: state } = await ctx.state.init({
      ...resolveColors(hostColor, ctx.session.hostId, opponentId),
      moves: [],
      whiteMs: startMs,
      blackMs: startMs,
      turnStartedAt: null,
      drawOfferedBy: null,
      result: null,
      resultReason: null,
    });
    if (state.whitePlayerId === COMPUTER_ID) {
      await ctx.deadline.set(COMPUTER_DELAY_MS, computerKey(state));
    }
    // Core's turn only ever names a real player.
    return { firstPlayerId: vsComputer ? ctx.session.hostId : state.whitePlayerId };
  },

  // The computer's move: the only deadline Chess sets.
  async onDeadline(ctx, key) {
    const stored = await ctx.state.get();
    if (!stored || key !== computerKey(stored.data)) return;
    await computerTurn(ctx, stored.data, stored.version);
  },

  async buildPlayProps(ctx) {
    const stored = await ctx.state.get();
    if (!stored) throw new GameError(500, "Chess game state not found");
    return {
      title: ctx.session.content.title,
      timeControlSeconds: ctx.session.content.data.timeControlSeconds,
      initialState: toPayload(stored.data, Date.now()),
      computerName: computerName(computerLevel(ctx.session.content.data) ?? "medium"),
    };
  },

  // Walking out of a game of chess loses it.
  async onPlayerLeft(ctx, { playerId: leaverId }) {
    const stored = await ctx.state.get();
    if (!stored || stored.data.result) return;
    const state = stored.data;
    // Someone watching a game against the computer has no side to lose.
    if (state.whitePlayerId !== leaverId && state.blackPlayerId !== leaverId) return;
    const leaverSide: Side = state.whitePlayerId === leaverId ? "white" : "black";
    await finishGame(ctx, state, stored.version, otherSide(leaverSide), "forfeit");
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyone = [...ctx.session.players, ...ctx.session.leftPlayers];
    const level = computerLevel(ctx.session.content.data);
    const nameOf = (id?: string) =>
      id === COMPUTER_ID && level ? computerName(level) : (everyone.find((p) => p.id === id)?.username ?? "Unknown");
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
          level: computerLevel(game.data),
          createdAt: game.createdAt,
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, input: z.infer<typeof CreateSchema>) => {
        const { hostColor, timeControlSeconds, opponent, level } = input;
        const vs = opponent === "computer" ? ` vs ${computerName(level)}` : "";
        const game = await ctx.content.create({
          title: input.title?.trim() || `Chess${vs} — ${timeControlLabel(timeControlSeconds)}`,
          data: opponent === "computer" ? { hostColor, timeControlSeconds, opponent, level } : { hostColor, timeControlSeconds },
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

        return playMove(ctx, state, version, side, input);
      },
    },

    /** The player's browser asking for the computer's reply, right after its own move. */
    computer: {
      access: "player",
      handler: async (ctx) => {
        const stored = await ctx.state.get();
        if (!stored) throw new GameError(404, "Game state missing");
        return (await computerTurn(ctx, stored.data, stored.version)) ?? toPayload(stored.data, Date.now());
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

        if (action === "offer" && opponentId === COMPUTER_ID) {
          const chess = replay(state.moves);
          const score = await evaluate(chess.fen()).catch(() => null);
          if (score !== null) {
            // The score is for the side to move; turn it round to the computer's view.
            const forComputer = sideToMove(chess) === side ? -score : score;
            const level = Math.abs(forComputer) <= DRAW_WHEN_LEVEL_CP && state.moves.length >= DRAW_WHEN_LEVEL_AFTER_PLIES;
            if (forComputer <= DRAW_WHEN_WORSE_CP || level) return finishGame(ctx, state, version, "draw", "agreement");
          }
          throw new GameError(400, "The computer declined your draw offer");
        }

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
