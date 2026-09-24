import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUser, sendPushToUsers } from "@/lib/push/send";
import { farkleGames, farkleTurns } from "./schema";
import { scoreSelection, hasAnyScoringSubset, RULESETS, type Ruleset } from "./scoring";
import { FarkleBoard } from "./components/FarkleBoard";
import { FarkleReveal } from "./components/FarkleReveal";
import BrowsePage from "./pages/BrowsePage";

const CreateSchema = z.object({
  title: z.string().min(1).max(100).optional(),
  targetScore: z.union([z.literal(2000), z.literal(3000), z.literal(5000)]),
  ruleset: z.enum(["original", "kcd"]),
});

const KeepSchema = z.object({
  diceIndices: z.array(z.number().int().min(0)).min(1),
});

async function getActivePlayers(sessionId: string) {
  return db
    .select({ playerId: sessionPlayers.playerId, joinOrder: sessionPlayers.joinOrder })
    .from(sessionPlayers)
    .where(and(eq(sessionPlayers.sessionId, sessionId), eq(sessionPlayers.isActive, true)))
    .orderBy(sessionPlayers.joinOrder);
}

function findNextPlayerId(players: { playerId: string | null }[], currentUserId: string): string {
  const idx = players.findIndex((p) => p.playerId === currentUserId);
  const next = players[(idx + 1) % players.length];
  return next.playerId!;
}

async function loadSessionAndTurn(shareCode: string) {
  const [session] = await db.select().from(sessions).where(eq(sessions.shareCode, shareCode));
  if (!session) return null;
  const [turn] = await db.select().from(farkleTurns).where(eq(farkleTurns.sessionId, session.id));
  return { session, turn };
}

async function handleRoot(req: NextRequest) {
  if (req.method === "GET") {
    const rows = await db
      .select({
        id: farkleGames.id,
        title: farkleGames.title,
        targetScore: farkleGames.targetScore,
        ruleset: farkleGames.ruleset,
        createdAt: farkleGames.createdAt,
      })
      .from(farkleGames)
      .orderBy(desc(farkleGames.createdAt))
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

    const { targetScore, ruleset } = parsed.data;
    const title = parsed.data.title?.trim() || `Farkle — ${RULESETS[ruleset].label} — First to ${targetScore}`;

    const [game] = await db
      .insert(farkleGames)
      .values({ authorId: user.id, title, targetScore, ruleset })
      .returning({ id: farkleGames.id, title: farkleGames.title });

    return NextResponse.json(game, { status: 201 });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

async function handleRoll(shareCode: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadSessionAndTurn(shareCode);
  if (!loaded) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const { session, turn } = loaded;
  if (session.status !== "in_progress") return NextResponse.json({ error: "Session not in progress" }, { status: 400 });
  if (session.currentPlayerId !== user.id) return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  if (!turn) return NextResponse.json({ error: "Turn state missing" }, { status: 500 });
  if (turn.diceRolled) return NextResponse.json({ error: "Resolve your current roll first" }, { status: 400 });

  const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
  if (!game) return NextResponse.json({ error: "Farkle game not found" }, { status: 404 });
  const ruleset = game.ruleset as Ruleset;

  const rolled = Array.from({ length: turn.diceRemaining }, () => Math.floor(Math.random() * 6) + 1);
  const farkled = !hasAnyScoringSubset(rolled, ruleset);
  const channel = supabase.channel(`session:${shareCode}`);

  if (farkled) {
    const players = await getActivePlayers(session.id);
    const nextId = findNextPlayerId(players, user.id);

    await db
      .update(farkleTurns)
      .set({ diceRolled: null, diceRemaining: 6, turnScore: 0, rollsThisTurn: 0, updatedAt: new Date() })
      .where(eq(farkleTurns.sessionId, session.id));
    await db.update(sessions).set({ currentPlayerId: nextId }).where(eq(sessions.id, session.id));

    const payload = {
      currentPlayerId: nextId,
      dice: rolled,
      diceRemaining: 6,
      turnScore: 0,
      rollsThisTurn: 0,
      scores: turn.scores,
      farkled: true,
      banked: false,
      hotDice: false,
    };

    Promise.all([
      channel.send({ type: "broadcast", event: "farkle:state", payload: { type: "farkle:state", payload } }),
      nextId !== user.id
        ? sendPushToUser(nextId, { title: "Your turn!", body: "The dice are yours.", url: `/${shareCode}/play` })
        : Promise.resolve(),
    ]).catch(() => {});

    return NextResponse.json({ dice: rolled, farkled: true, turnScore: 0, diceRemaining: 6, currentPlayerId: nextId, scores: turn.scores });
  }

  const rollsThisTurn = turn.rollsThisTurn + 1;
  await db
    .update(farkleTurns)
    .set({ diceRolled: rolled, rollsThisTurn, updatedAt: new Date() })
    .where(eq(farkleTurns.sessionId, session.id));

  const payload = {
    currentPlayerId: user.id,
    dice: rolled,
    diceRemaining: turn.diceRemaining,
    turnScore: turn.turnScore,
    rollsThisTurn,
    scores: turn.scores,
    farkled: false,
    banked: false,
    hotDice: false,
  };
  channel.send({ type: "broadcast", event: "farkle:state", payload: { type: "farkle:state", payload } }).catch(() => {});

  return NextResponse.json({ dice: rolled, farkled: false, turnScore: turn.turnScore, diceRemaining: turn.diceRemaining, currentPlayerId: user.id, scores: turn.scores });
}

async function handleKeep(req: NextRequest, shareCode: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = KeepSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const loaded = await loadSessionAndTurn(shareCode);
  if (!loaded) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const { session, turn } = loaded;
  if (session.status !== "in_progress") return NextResponse.json({ error: "Session not in progress" }, { status: 400 });
  if (session.currentPlayerId !== user.id) return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  if (!turn || !turn.diceRolled) return NextResponse.json({ error: "No roll to resolve" }, { status: 400 });

  const { diceIndices } = parsed.data;
  const dice = turn.diceRolled;
  const uniqueIndices = new Set(diceIndices);
  if (uniqueIndices.size !== diceIndices.length || diceIndices.some((i) => i >= dice.length)) {
    return NextResponse.json({ error: "Invalid dice selection" }, { status: 400 });
  }

  const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
  if (!game) return NextResponse.json({ error: "Farkle game not found" }, { status: 404 });
  const ruleset = game.ruleset as Ruleset;

  const selected = diceIndices.map((i) => dice[i]);
  const result = scoreSelection(selected, ruleset);
  if (!result.valid) return NextResponse.json({ error: "That's not a valid scoring selection" }, { status: 400 });

  let diceRemaining = turn.diceRemaining - selected.length;
  let hotDice = false;
  if (diceRemaining === 0) {
    diceRemaining = 6;
    hotDice = true;
  }
  const turnScore = turn.turnScore + result.points;

  await db
    .update(farkleTurns)
    .set({ diceRolled: null, diceRemaining, turnScore, updatedAt: new Date() })
    .where(eq(farkleTurns.sessionId, session.id));

  const payload = {
    currentPlayerId: user.id,
    dice: null,
    diceRemaining,
    turnScore,
    rollsThisTurn: turn.rollsThisTurn,
    scores: turn.scores,
    farkled: false,
    banked: false,
    hotDice,
  };
  supabase.channel(`session:${shareCode}`).send({ type: "broadcast", event: "farkle:state", payload: { type: "farkle:state", payload } }).catch(() => {});

  return NextResponse.json({ points: result.points, turnScore, diceRemaining, hotDice });
}

async function handleBank(shareCode: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const loaded = await loadSessionAndTurn(shareCode);
  if (!loaded) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const { session, turn } = loaded;
  if (session.status !== "in_progress") return NextResponse.json({ error: "Session not in progress" }, { status: 400 });
  if (session.currentPlayerId !== user.id) return NextResponse.json({ error: "Not your turn" }, { status: 403 });
  if (!turn) return NextResponse.json({ error: "Turn state missing" }, { status: 500 });
  if (turn.diceRolled) return NextResponse.json({ error: "Resolve your current roll first" }, { status: 400 });
  if (turn.turnScore <= 0) return NextResponse.json({ error: "Nothing to bank yet" }, { status: 400 });

  const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
  if (!game) return NextResponse.json({ error: "Farkle game not found" }, { status: 404 });
  const ruleset = game.ruleset as Ruleset;
  const meta = RULESETS[ruleset];

  const hasBankedBefore = (turn.scores[user.id] ?? 0) > 0;
  if (!hasBankedBefore && turn.turnScore < meta.minEntryScore) {
    return NextResponse.json(
      { error: `You need at least ${meta.minEntryScore} points in a turn before you can bank for the first time` },
      { status: 400 }
    );
  }

  const bankedAmount = turn.turnScore;
  const newTotal = (turn.scores[user.id] ?? 0) + bankedAmount;
  const scores = { ...turn.scores, [user.id]: newTotal };
  const won = newTotal >= game.targetScore;

  await db
    .update(farkleTurns)
    .set({ diceRolled: null, diceRemaining: 6, turnScore: 0, rollsThisTurn: 0, scores, updatedAt: new Date() })
    .where(eq(farkleTurns.sessionId, session.id));

  if (won) {
    const completedAt = new Date();
    await db.update(sessions).set({ status: "completed", completedAt }).where(eq(sessions.id, session.id));

    const players = await getActivePlayers(session.id);
    const otherIds = players.map((p) => p.playerId).filter((id): id is string => !!id && id !== user.id);

    Promise.all([
      supabase.channel(`session:${shareCode}`).send({
        type: "broadcast",
        event: "session:completed",
        payload: { type: "session:completed", payload: { completedAt: completedAt.toISOString() } },
      }),
      supabase.channel(`session:${shareCode}`).send({
        type: "broadcast",
        event: "session:revealed",
        payload: { type: "session:revealed", payload: {} },
      }),
      sendPushToUsers(otherIds, {
        title: "Farkle finished!",
        body: "Someone reached the target — come see who won!",
        url: `/${shareCode}/reveal`,
      }),
    ]).catch(() => {});

    return NextResponse.json({ banked: bankedAmount, totalScore: newTotal, won: true, scores });
  }

  const players = await getActivePlayers(session.id);
  const nextId = findNextPlayerId(players, user.id);
  await db.update(sessions).set({ currentPlayerId: nextId }).where(eq(sessions.id, session.id));

  const payload = {
    currentPlayerId: nextId,
    dice: null,
    diceRemaining: 6,
    turnScore: 0,
    rollsThisTurn: 0,
    scores,
    farkled: false,
    banked: true,
    hotDice: false,
    bankedAmount,
  };

  Promise.all([
    supabase.channel(`session:${shareCode}`).send({ type: "broadcast", event: "farkle:state", payload: { type: "farkle:state", payload } }),
    nextId !== user.id
      ? sendPushToUser(nextId, { title: "Your turn!", body: "The dice are yours.", url: `/${shareCode}/play` })
      : Promise.resolve(),
  ]).catch(() => {});

  return NextResponse.json({ banked: bankedAmount, totalScore: newTotal, won: false, scores, currentPlayerId: nextId });
}

async function handleState(shareCode: string) {
  const loaded = await loadSessionAndTurn(shareCode);
  if (!loaded) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  const { session, turn } = loaded;
  return NextResponse.json({
    status: session.status,
    currentPlayerId: session.currentPlayerId,
    dice: turn?.diceRolled ?? null,
    diceRemaining: turn?.diceRemaining ?? 6,
    turnScore: turn?.turnScore ?? 0,
    rollsThisTurn: turn?.rollsThisTurn ?? 0,
    scores: turn?.scores ?? {},
  });
}

export const plugin: GamePlugin = {
  gameType: "farkle",
  displayName: "Farkle",
  description: "Roll six dice, bank your points before you bust — first to the target wins",
  browsePath: "/games/farkle",
  minPlayers: 2,
  maxPlayers: 6,
  supportsRandomize: false,

  async getContentMeta(gameContentId: string) {
    const [game] = await db.select({ title: farkleGames.title }).from(farkleGames).where(eq(farkleGames.id, gameContentId));
    if (!game) throw new Error("Farkle game not found");
    return { title: game.title };
  },

  async getLobbyMeta(session) {
    const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
    if (!game) return { subtitle: "" };
    return { subtitle: `First to ${game.targetScore} · ${RULESETS[game.ruleset as Ruleset].label}` };
  },

  async start(session, players: SessionPlayerInfo[]) {
    const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
    // Structurally required by the shared engine, functionally unused by
    // Farkle — all real turn advancement happens in the roll/keep/bank
    // handlers above, which write sessions.currentPlayerId directly.
    const tokenOrder = sorted.map((p) => `turn_${p.playerId}`);
    await db.insert(farkleTurns).values({ sessionId: session.id }).onConflictDoNothing();
    return { tokenOrder, firstPlayerId: sorted[0]?.playerId };
  },

  async getAnswerHints(_ctx: AnswerContext) {
    return {}; // the shared /api/sessions/[code]/answer route is never called for farkle
  },

  async buildPlayProps(session) {
    const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
    if (!game) throw new Error("Farkle game not found");
    const [turn] = await db.select().from(farkleTurns).where(eq(farkleTurns.sessionId, session.id));

    return {
      title: game.title,
      targetScore: game.targetScore,
      ruleset: game.ruleset as Ruleset,
      initialCurrentPlayerId: session.currentPlayerId ?? session.hostId,
      initialDice: (turn?.diceRolled ?? null) as number[] | null,
      initialDiceRemaining: turn?.diceRemaining ?? 6,
      initialTurnScore: turn?.turnScore ?? 0,
      initialRollsThisTurn: turn?.rollsThisTurn ?? 0,
      initialScores: (turn?.scores ?? {}) as Record<string, number>,
    };
  },

  async buildResult(session, _answers) {
    const [game] = await db.select().from(farkleGames).where(eq(farkleGames.id, session.gameContentId!));
    const [turn] = await db.select().from(farkleTurns).where(eq(farkleTurns.sessionId, session.id));
    const rows = await db
      .select({ playerId: sessionPlayers.playerId, username: profiles.username })
      .from(sessionPlayers)
      .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
      .where(eq(sessionPlayers.sessionId, session.id))
      .orderBy(sessionPlayers.joinOrder);

    const scores = (turn?.scores ?? {}) as Record<string, number>;
    const standings = rows
      .map((r) => ({ playerId: r.playerId!, player: r.username ?? "Unknown", score: scores[r.playerId!] ?? 0 }))
      .sort((a, b) => b.score - a.score);

    return {
      title: game?.title ?? "Farkle",
      ruleset: (game?.ruleset ?? "original") as Ruleset,
      targetScore: game?.targetScore ?? 3000,
      standings,
    };
  },

  async handleRequest(req: NextRequest, path: string[]) {
    const [seg0, seg1] = path;
    if (!seg0) return handleRoot(req);

    if (req.method === "POST" && seg1 === "roll") return handleRoll(seg0);
    if (req.method === "POST" && seg1 === "keep") return handleKeep(req, seg0);
    if (req.method === "POST" && seg1 === "bank") return handleBank(seg0);
    if (req.method === "GET" && seg1 === "state") return handleState(seg0);

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },

  PlayComponent: FarkleBoard,
  RevealComponent: FarkleReveal,
  BrowsePage,
};
