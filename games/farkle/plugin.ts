import type { z } from "zod";
import { defineGame, GameError, type SessionContext } from "@/lib/game-sdk";
import { CreateSchema, KeepSchema, type FarkleContent, type FarkleState, type FarkleStatePayload } from "./schema";
import { scoreSelection, hasAnyScoringSubset, RULESETS } from "./scoring";
import { FarkleBoard } from "./components/FarkleBoard";
import { FarkleReveal } from "./components/FarkleReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<FarkleContent, FarkleState>;

const FRESH_TURN = { diceRolled: null, diceRemaining: 6, turnScore: 0, rollsThisTurn: 0 };

/** The live turn, for the player whose turn it is. Core has already checked they're a player of a game in progress. */
async function loadTurn(ctx: Ctx) {
  if (ctx.session.currentPlayerId !== ctx.viewer!.id) throw new GameError(403, "Not your turn");
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Turn state missing");
  return { turn: stored.data, version: stored.version };
}

function nextPlayerId(ctx: Ctx): string {
  const { players } = ctx.session;
  const idx = players.findIndex((p) => p.id === ctx.viewer!.id);
  return players[(idx + 1) % players.length].id;
}

/** Hands the dice to the next player and lets them know. */
async function passTurn(ctx: Ctx, nextId: string) {
  await ctx.turn.set(nextId);
  if (nextId !== ctx.viewer!.id) await ctx.notify(nextId, { title: "Your turn!", body: "The dice are yours." });
}

export const plugin = defineGame<FarkleContent, FarkleState>({
  gameType: "farkle",
  displayName: "Farkle",
  description: "Roll six dice, bank your points before you bust — first to the target wins",
  minPlayers: 2,
  maxPlayers: 6,

  async getLobbyMeta(ctx) {
    const { targetScore, ruleset } = ctx.session.content.data;
    return { subtitle: `First to ${targetScore} · ${RULESETS[ruleset].label}` };
  },

  async start(ctx) {
    await ctx.state.init({ ...FRESH_TURN, scores: {} });
    return { firstPlayerId: ctx.session.players[0]?.id };
  },

  async buildPlayProps(ctx) {
    const turn = (await ctx.state.get())?.data;
    const { title, data } = ctx.session.content;
    return {
      title,
      targetScore: data.targetScore,
      ruleset: data.ruleset,
      initialCurrentPlayerId: ctx.session.currentPlayerId ?? ctx.session.hostId,
      initialDice: turn?.diceRolled ?? null,
      initialDiceRemaining: turn?.diceRemaining ?? 6,
      initialTurnScore: turn?.turnScore ?? 0,
      initialRollsThisTurn: turn?.rollsThisTurn ?? 0,
      initialScores: turn?.scores ?? {},
    };
  },

  async buildResult(ctx) {
    const scores = (await ctx.state.get())?.data.scores ?? {};
    const standings = ctx.session.players
      .map((p) => ({ playerId: p.id, player: p.username, score: scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const { title, data } = ctx.session.content;
    return { title, ruleset: data.ruleset, targetScore: data.targetScore, standings };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      handler: async (ctx) =>
        (await ctx.content.list({ limit: 20 })).map((game) => ({
          id: game.id,
          title: game.title,
          targetScore: game.data.targetScore,
          ruleset: game.data.ruleset,
          createdAt: game.createdAt,
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, input: z.infer<typeof CreateSchema>) => {
        const { targetScore, ruleset } = input;
        const game = await ctx.content.create({
          title: input.title?.trim() || `Farkle — ${RULESETS[ruleset].label} — First to ${targetScore}`,
          data: { targetScore, ruleset },
        });
        return { id: game.id, title: game.title };
      },
    },
  },

  sessionActions: {
    roll: {
      access: "player",
      handler: async (ctx) => {
        const { turn, version } = await loadTurn(ctx);
        if (turn.diceRolled) throw new GameError(400, "Resolve your current roll first");

        const { ruleset } = ctx.session.content.data;
        const rolled = Array.from({ length: turn.diceRemaining }, () => Math.floor(Math.random() * 6) + 1);

        if (!hasAnyScoringSubset(rolled, ruleset)) {
          // Bust: the turn's points are gone and the dice move on.
          const nextId = nextPlayerId(ctx);
          await ctx.state.update({ ...FRESH_TURN, scores: turn.scores }, { expectedVersion: version });
          await passTurn(ctx, nextId);
          const payload: FarkleStatePayload = {
            currentPlayerId: nextId,
            dice: null,
            ...{ diceRemaining: 6, turnScore: 0, rollsThisTurn: 0 },
            scores: turn.scores,
            farkled: true,
            banked: false,
            hotDice: false,
          };
          await ctx.broadcast("state", payload);
          // The roller alone gets the dice that busted them.
          return { ...payload, dice: rolled };
        }

        const rollsThisTurn = turn.rollsThisTurn + 1;
        await ctx.state.update({ ...turn, diceRolled: rolled, rollsThisTurn }, { expectedVersion: version });
        const payload: FarkleStatePayload = {
          currentPlayerId: ctx.viewer!.id,
          dice: rolled,
          diceRemaining: turn.diceRemaining,
          turnScore: turn.turnScore,
          rollsThisTurn,
          scores: turn.scores,
          farkled: false,
          banked: false,
          hotDice: false,
        };
        await ctx.broadcast("state", payload);
        return payload;
      },
    },

    keep: {
      access: "player",
      input: KeepSchema,
      handler: async (ctx, { diceIndices }: z.infer<typeof KeepSchema>) => {
        const { turn, version } = await loadTurn(ctx);
        const dice = turn.diceRolled;
        if (!dice) throw new GameError(400, "No roll to resolve");
        if (new Set(diceIndices).size !== diceIndices.length || diceIndices.some((i) => i >= dice.length)) {
          throw new GameError(400, "Invalid dice selection");
        }

        const selected = diceIndices.map((i) => dice[i]);
        const result = scoreSelection(selected, ctx.session.content.data.ruleset);
        if (!result.valid) throw new GameError(400, "That's not a valid scoring selection");

        // Setting aside all six ("hot dice") puts all six back in play.
        const left = turn.diceRemaining - selected.length;
        const hotDice = left === 0;
        const diceRemaining = hotDice ? 6 : left;
        const turnScore = turn.turnScore + result.points;

        await ctx.state.update({ ...turn, diceRolled: null, diceRemaining, turnScore }, { expectedVersion: version });
        const payload: FarkleStatePayload = {
          currentPlayerId: ctx.viewer!.id,
          dice: null,
          diceRemaining,
          turnScore,
          rollsThisTurn: turn.rollsThisTurn,
          scores: turn.scores,
          farkled: false,
          banked: false,
          hotDice,
        };
        await ctx.broadcast("state", payload);
        return { ...payload, points: result.points };
      },
    },

    bank: {
      access: "player",
      handler: async (ctx) => {
        const { turn, version } = await loadTurn(ctx);
        if (turn.diceRolled) throw new GameError(400, "Resolve your current roll first");
        if (turn.turnScore <= 0) throw new GameError(400, "Nothing to bank yet");

        const me = ctx.viewer!.id;
        const { targetScore, ruleset } = ctx.session.content.data;
        const { minEntryScore } = RULESETS[ruleset];
        const hasBankedBefore = (turn.scores[me] ?? 0) > 0;
        if (!hasBankedBefore && turn.turnScore < minEntryScore) {
          throw new GameError(400, `You need at least ${minEntryScore} points in a turn before you can bank for the first time`);
        }

        const bankedAmount = turn.turnScore;
        const totalScore = (turn.scores[me] ?? 0) + bankedAmount;
        const scores = { ...turn.scores, [me]: totalScore };
        await ctx.state.update({ ...FRESH_TURN, scores }, { expectedVersion: version });

        if (totalScore >= targetScore) {
          await ctx.finish();
          await ctx.notify("others", { title: "Farkle finished!", body: "Someone reached the target — come see who won!" });
          return { banked: bankedAmount, totalScore, won: true, scores };
        }

        const nextId = nextPlayerId(ctx);
        await passTurn(ctx, nextId);
        const payload: FarkleStatePayload = {
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
        await ctx.broadcast("state", payload);
        return { banked: bankedAmount, totalScore, won: false, scores, currentPlayerId: nextId };
      },
    },

    /** The current turn — for a browser catching up. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => {
        const turn = (await ctx.state.get())?.data;
        return {
          status: ctx.session.status,
          currentPlayerId: ctx.session.currentPlayerId,
          dice: turn?.diceRolled ?? null,
          diceRemaining: turn?.diceRemaining ?? 6,
          turnScore: turn?.turnScore ?? 0,
          rollsThisTurn: turn?.rollsThisTurn ?? 0,
          scores: turn?.scores ?? {},
        };
      },
    },
  },

  PlayComponent: FarkleBoard,
  RevealComponent: FarkleReveal,
  BrowsePage,
});
