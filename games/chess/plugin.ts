import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc, isNull } from "drizzle-orm";
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session } from "@/lib/db/schema";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push/send";
import { getViewerRole } from "@/lib/sessions/access";
import { chessGames, chessStates, type ChessState } from "./schema";
import { remainingMs, timeControlLabel, TIME_CONTROLS, type Side } from "./clock";
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

const TIME_CONTROL_SECONDS = TIME_CONTROLS.map((t) => t.seconds);

const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  hostColor: z.enum(["white", "black", "random"]),
  timeControlSeconds: z
    .number()
    .int()
    .nullable()
    .refine((s) => TIME_CONTROL_SECONDS.includes(s), "Unsupported time control"),
});

const SQUARE = z.string().regex(/^[a-h][1-8]$/);
const MoveSchema = z.object({
  from: SQUARE,
  to: SQUARE,
  promotion: z.enum(["q", "r", "b", "n"]).optional(),
});

const DrawSchema = z.object({
  action: z.enum(["offer", "accept", "decline"]),
});

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

function toPayload(state: ChessState, now: number): ChessStatePayload {
  const toMove = state.moves.length % 2 === 0 ? "white" : "black";
  return {
    moves: state.moves,
    whitePlayerId: state.whitePlayerId,
    blackPlayerId: state.blackPlayerId,
    currentPlayerId: toMove === "white" ? state.whitePlayerId : state.blackPlayerId,
    whiteMs: state.whiteMs,
    blackMs: state.blackMs,
    turnStartedAt: state.turnStartedAt?.getTime() ?? null,
    serverNow: now,
    drawOfferedBy: state.drawOfferedBy,
    result: state.result,
    resultReason: state.resultReason,
  };
}

function playerSide(state: ChessState, userId: string): Side | null {
  if (state.whitePlayerId === userId) return "white";
  if (state.blackPlayerId === userId) return "black";
  return null;
}

function playerId(state: ChessState, side: Side): string {
  return side === "white" ? state.whitePlayerId : state.blackPlayerId;
}

function broadcastState(supabase: SupabaseServerClient, shareCode: string, payload: ChessStatePayload) {
  return supabase
    .channel(`session:${shareCode}`)
    .send({ type: "broadcast", event: "chess:state", payload: { type: "chess:state", payload } });
}

/**
 * Loads everything a player action needs, or the error response to return.
 * Every mutating route requires a signed-in player of a game still in progress.
 */
async function loadForAction(shareCode: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, shareCode));
  if (!session) return { error: NextResponse.json({ error: "Session not found" }, { status: 404 }) };
  if (session.status !== "in_progress") {
    return { error: NextResponse.json({ error: "Session not in progress" }, { status: 400 }) };
  }

  const [state] = await db.select().from(chessStates).where(eq(chessStates.sessionId, session.id));
  if (!state) return { error: NextResponse.json({ error: "Game state missing" }, { status: 500 }) };
  if (state.result) return { error: NextResponse.json({ error: "Game is already over" }, { status: 400 }) };

  const side = playerSide(state, user.id);
  if (!side) return { error: NextResponse.json({ error: "Not a player in this game" }, { status: 403 }) };

  return { supabase, user, session, state, side };
}

/**
 * Ends the game. The `result IS NULL` guard makes this safe when both clients
 * report the same ending at once (e.g. both flag an expired clock).
 */
async function finishGame(
  supabase: SupabaseServerClient,
  session: Session,
  shareCode: string,
  result: GameResult,
  reason: ResultReason,
  changes: Partial<ChessState> = {}
): Promise<ChessStatePayload | null> {
  const [finished] = await db
    .update(chessStates)
    .set({ ...changes, result, resultReason: reason, drawOfferedBy: null, turnStartedAt: null, updatedAt: new Date() })
    .where(and(eq(chessStates.sessionId, session.id), isNull(chessStates.result)))
    .returning();
  if (!finished) return null;

  const completedAt = new Date();
  await db.update(sessions).set({ status: "completed", completedAt }).where(eq(sessions.id, session.id));

  const payload = toPayload(finished, Date.now());
  const channel = supabase.channel(`session:${shareCode}`);
  Promise.all([
    broadcastState(supabase, shareCode, payload),
    channel.send({
      type: "broadcast",
      event: "session:completed",
      payload: { type: "session:completed", payload: { completedAt: completedAt.toISOString() } },
    }),
    channel.send({
      type: "broadcast",
      event: "session:revealed",
      payload: { type: "session:revealed", payload: {} },
    }),
  ]).catch(() => {});

  return payload;
}

async function handleRoot(req: NextRequest) {
  if (req.method === "GET") {
    const rows = await db
      .select({
        id: chessGames.id,
        title: chessGames.title,
        hostColor: chessGames.hostColor,
        timeControlSeconds: chessGames.timeControlSeconds,
        createdAt: chessGames.createdAt,
      })
      .from(chessGames)
      .orderBy(desc(chessGames.createdAt))
      .limit(20);
    return NextResponse.json(rows);
  }

  if (req.method === "POST") {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const { hostColor, timeControlSeconds } = parsed.data;
    const title = parsed.data.title?.trim() || `Chess — ${timeControlLabel(timeControlSeconds)}`;

    const [game] = await db
      .insert(chessGames)
      .values({ authorId: user.id, title, hostColor, timeControlSeconds })
      .returning({ id: chessGames.id, title: chessGames.title });

    return NextResponse.json(game, { status: 201 });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function handleMove(req: NextRequest, shareCode: string) {
  const body = await req.json();
  const parsed = MoveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const loaded = await loadForAction(shareCode);
  if (loaded.error) return loaded.error;
  const { supabase, user, session, state, side } = loaded;

  const chess = replay(state.moves);
  const toMove = sideToMove(chess);
  if (side !== toMove) return NextResponse.json({ error: "Not your turn" }, { status: 403 });

  const now = Date.now();
  const clock = { whiteMs: state.whiteMs, blackMs: state.blackMs, turnStartedAt: state.turnStartedAt?.getTime() ?? null };
  const timeLeft = remainingMs(clock, side, toMove, now);
  if (timeLeft !== null && timeLeft <= 0) {
    const payload = await finishGame(supabase, session, shareCode, otherSide(side), "timeout", {
      [side === "white" ? "whiteMs" : "blackMs"]: 0,
    });
    return NextResponse.json({ error: "You ran out of time", state: payload }, { status: 409 });
  }

  try {
    chess.move(parsed.data);
  } catch {
    return NextResponse.json({ error: "Illegal move" }, { status: 400 });
  }

  const moves = chess.history();
  const changes: Partial<ChessState> = {
    fen: chess.fen(),
    moves,
    // An offer stands until the opponent answers it or moves — so moving
    // clears the opponent's offer, but not one you made yourself.
    drawOfferedBy: state.drawOfferedBy === user.id ? state.drawOfferedBy : null,
  };
  if (timeLeft !== null) {
    changes[side === "white" ? "whiteMs" : "blackMs"] = timeLeft;
    changes.turnStartedAt = new Date(now);
  }

  const end = detectEnd(chess);
  if (end) {
    const payload = await finishGame(supabase, session, shareCode, end.result, end.reason, changes);
    if (!payload) return NextResponse.json({ error: "Game is already over" }, { status: 409 });
    return NextResponse.json(payload);
  }

  // Guard on the previous position so a double-submitted move can't apply twice.
  const [updated] = await db
    .update(chessStates)
    .set({ ...changes, updatedAt: new Date() })
    .where(and(eq(chessStates.sessionId, session.id), eq(chessStates.fen, state.fen), isNull(chessStates.result)))
    .returning();
  if (!updated) return NextResponse.json({ error: "The position changed — try again" }, { status: 409 });

  const nextId = playerId(updated, otherSide(side));
  await db.update(sessions).set({ currentPlayerId: nextId }).where(eq(sessions.id, session.id));

  const payload = toPayload(updated, Date.now());
  Promise.all([
    broadcastState(supabase, shareCode, payload),
    sendPushToUser(nextId, { title: "Your move!", body: `${moves[moves.length - 1]} was played.`, url: `/${shareCode}/play` }),
  ]).catch(() => {});

  return NextResponse.json(payload);
}

async function handleResign(shareCode: string) {
  const loaded = await loadForAction(shareCode);
  if (loaded.error) return loaded.error;
  const { supabase, session, side } = loaded;

  const payload = await finishGame(supabase, session, shareCode, otherSide(side), "resignation");
  if (!payload) return NextResponse.json({ error: "Game is already over" }, { status: 409 });
  return NextResponse.json(payload);
}

async function handleDraw(req: NextRequest, shareCode: string) {
  const body = await req.json();
  const parsed = DrawSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { action } = parsed.data;

  const loaded = await loadForAction(shareCode);
  if (loaded.error) return loaded.error;
  const { supabase, user, session, state, side } = loaded;

  const opponentId = playerId(state, otherSide(side));
  const opponentOffered = state.drawOfferedBy === opponentId;

  // Offering back while the opponent's offer is open is the same as accepting.
  if (action === "accept" || (action === "offer" && opponentOffered)) {
    if (!opponentOffered) return NextResponse.json({ error: "No draw offer to accept" }, { status: 400 });
    const payload = await finishGame(supabase, session, shareCode, "draw", "agreement");
    if (!payload) return NextResponse.json({ error: "Game is already over" }, { status: 409 });
    return NextResponse.json(payload);
  }

  if (action === "decline" && !opponentOffered) {
    return NextResponse.json({ error: "No draw offer to decline" }, { status: 400 });
  }
  if (action === "offer" && state.drawOfferedBy === user.id) {
    return NextResponse.json({ error: "You already offered a draw" }, { status: 400 });
  }

  const [updated] = await db
    .update(chessStates)
    .set({ drawOfferedBy: action === "offer" ? user.id : null, updatedAt: new Date() })
    .where(and(eq(chessStates.sessionId, session.id), isNull(chessStates.result)))
    .returning();
  if (!updated) return NextResponse.json({ error: "Game is already over" }, { status: 409 });

  const payload = toPayload(updated, Date.now());
  Promise.all([
    broadcastState(supabase, shareCode, payload),
    action === "offer"
      ? sendPushToUser(opponentId, { title: "Draw offered", body: "Your opponent offered a draw.", url: `/${shareCode}/play` })
      : Promise.resolve(),
  ]).catch(() => {});

  return NextResponse.json(payload);
}

/** Either player reports that the clock of the side to move has run out. */
async function handleFlag(shareCode: string) {
  const loaded = await loadForAction(shareCode);
  if (loaded.error) return loaded.error;
  const { supabase, session, state } = loaded;

  const toMove: Side = state.moves.length % 2 === 0 ? "white" : "black";
  const clock = { whiteMs: state.whiteMs, blackMs: state.blackMs, turnStartedAt: state.turnStartedAt?.getTime() ?? null };
  const timeLeft = remainingMs(clock, toMove, toMove, Date.now());
  if (timeLeft === null || timeLeft > 0) {
    return NextResponse.json({ error: "The clock hasn't run out", state: toPayload(state, Date.now()) }, { status: 400 });
  }

  const payload = await finishGame(supabase, session, shareCode, otherSide(toMove), "timeout", {
    [toMove === "white" ? "whiteMs" : "blackMs"]: 0,
  });
  if (!payload) return NextResponse.json({ error: "Game is already over" }, { status: 409 });
  return NextResponse.json(payload);
}

async function handleState(shareCode: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, shareCode));
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  // A private game's live state is for its players only; a public one is open to watch.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if ((await getViewerRole(session, user?.id)) === "denied") {
    return NextResponse.json({ error: "This game is private" }, { status: 403 });
  }

  const [state] = await db.select().from(chessStates).where(eq(chessStates.sessionId, session.id));
  if (!state) return NextResponse.json({ error: "Game state missing" }, { status: 404 });
  return NextResponse.json(toPayload(state, Date.now()));
}

export const plugin: GamePlugin = {
  gameType: "chess",
  displayName: "Chess",
  description: "The classic two-player game — untimed or against the clock",
  browsePath: "/games/chess",
  minPlayers: 2,
  maxPlayers: 2,
  supportsRandomize: false,

  async getContentMeta(gameContentId: string) {
    const [game] = await db.select({ title: chessGames.title }).from(chessGames).where(eq(chessGames.id, gameContentId));
    if (!game) throw new Error("Chess game not found");
    return { title: game.title };
  },

  async getLobbyMeta(session) {
    const [game] = await db.select().from(chessGames).where(eq(chessGames.id, session.gameContentId!));
    if (!game) return { subtitle: "" };
    const colors = game.hostColor === "random" ? "Random colors" : `Host plays ${game.hostColor}`;
    return { subtitle: `${colors} · ${timeControlLabel(game.timeControlSeconds)}` };
  },

  async start(session, players: SessionPlayerInfo[]) {
    const [game] = await db.select().from(chessGames).where(eq(chessGames.id, session.gameContentId!));
    if (!game) throw new Error("Chess game not found");

    const guest = players.find((p) => p.playerId !== session.hostId);
    if (!guest) throw new Error("Chess needs two players");
    const colors = resolveColors(game.hostColor, session.hostId, guest.playerId);
    const startMs = game.timeControlSeconds === null ? null : game.timeControlSeconds * 1000;

    await db
      .insert(chessStates)
      .values({ sessionId: session.id, ...colors, fen: replay([]).fen(), whiteMs: startMs, blackMs: startMs })
      .onConflictDoNothing();
    // Re-read rather than trust `colors`: if a row already existed, its colors win.
    const [state] = await db.select().from(chessStates).where(eq(chessStates.sessionId, session.id));

    // tokenOrder is structurally required by the shared engine, functionally
    // unused by chess — the move handler writes sessions.currentPlayerId directly.
    const tokenOrder = [`turn_${state.whitePlayerId}`, `turn_${state.blackPlayerId}`];
    return { tokenOrder, firstPlayerId: state.whitePlayerId };
  },

  async getAnswerHints(_ctx: AnswerContext) {
    return {}; // the shared /api/sessions/[code]/answer route is never called for chess
  },

  async buildPlayProps(session) {
    const [game] = await db.select().from(chessGames).where(eq(chessGames.id, session.gameContentId!));
    if (!game) throw new Error("Chess game not found");
    const [state] = await db.select().from(chessStates).where(eq(chessStates.sessionId, session.id));
    if (!state) throw new Error("Chess game state not found");

    return {
      title: game.title,
      timeControlSeconds: game.timeControlSeconds,
      initialState: toPayload(state, Date.now()),
    };
  },

  async buildResult(session, _answers) {
    const [game] = await db.select().from(chessGames).where(eq(chessGames.id, session.gameContentId!));
    const [state] = await db.select().from(chessStates).where(eq(chessStates.sessionId, session.id));
    const rows = await db
      .select({ playerId: sessionPlayers.playerId, username: profiles.username })
      .from(sessionPlayers)
      .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
      .where(eq(sessionPlayers.sessionId, session.id));
    const nameOf = (id?: string) => rows.find((r) => r.playerId === id)?.username ?? "Unknown";

    return {
      title: game?.title ?? "Chess",
      timeControlSeconds: game?.timeControlSeconds ?? null,
      white: nameOf(state?.whitePlayerId),
      black: nameOf(state?.blackPlayerId),
      moves: state?.moves ?? [],
      result: state?.result ?? null,
      resultReason: state?.resultReason ?? null,
    };
  },

  async handleRequest(req: NextRequest, path: string[]) {
    const [seg0, seg1] = path;
    if (!seg0) return handleRoot(req);

    if (req.method === "POST" && seg1 === "move") return handleMove(req, seg0);
    if (req.method === "POST" && seg1 === "resign") return handleResign(seg0);
    if (req.method === "POST" && seg1 === "draw") return handleDraw(req, seg0);
    if (req.method === "POST" && seg1 === "flag") return handleFlag(seg0);
    if (req.method === "GET" && seg1 === "state") return handleState(seg0);

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },

  PlayComponent: ChessBoard,
  RevealComponent: ChessReveal,
  BrowsePage,
};
