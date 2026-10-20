import type { z } from "zod";
import { defineGame, GameError, shuffle, type SessionContext } from "@/lib/game-sdk";
import {
  BonusPickSchema,
  CreateSchema,
  LetterSchema,
  SolveSchema,
  StepSchema,
  type ChangedPayload,
  type DiscusContent,
  type DiscusState,
} from "./schema";
import { BONUS_SECONDS, WEDGE_COUNT } from "./board";
import {
  bonusPick,
  bonusSolve,
  buyVowel,
  callConsonant,
  endBonus,
  freshState,
  getPuzzle,
  isLastRound,
  nextRound,
  passTurn,
  pickPuzzles,
  solve,
  spin,
  startBonus,
  viewFor,
  withoutPlayer,
} from "./rules";
import { DiscusBoard } from "./components/DiscusBoard";
import { DiscusReveal } from "./components/DiscusReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<DiscusContent, DiscusState>;

const GAME = "Discus of Wealth";
const describe = (data: DiscusContent) => `${data.rounds} puzzles${data.bonus ? " + bonus round" : ""}`;

// The phases a turn timer runs in.
const timed = (state: DiscusState) => state.phase === "turn" || state.phase === "call";
const isBonus = (state: DiscusState) => state.phase === "bonusPick" || state.phase === "bonusSolve";

/**
 * Applies `change` to the latest state and deals with what follows from it:
 * the turn, the timer, the push, the broadcast, and the end of the game.
 * `change` must be pure — it runs again if another write lands first — and
 * refuses a request by throwing a GameError. Returns the caller's view.
 */
async function apply(ctx: Ctx, change: (state: DiscusState) => DiscusState) {
  let before: DiscusState | undefined;
  const { data: next, changed } = await ctx.state.mutate((state) => {
    before = state;
    const after = change(state);
    return after === state ? state : { ...after, step: state.step + 1 };
  });
  const view = viewFor(next, ctx.viewer?.id ?? null);
  if (!changed || !before) return view;

  if (next.turnId !== before.turnId) await ctx.turn.set(next.turnId);

  const timer = ctx.session.timerSeconds;
  if (next.phase === "bonusSolve" && before.phase !== "bonusSolve") {
    await ctx.deadline.set(BONUS_SECONDS * 1000, "bonus");
  } else if (timer && timed(next)) {
    // Every move earns fresh time; the key names the step, so a stale deadline does nothing.
    await ctx.deadline.set(timer * 1000, `turn:${next.step}`);
  } else if ((timer && timed(before)) || before.phase === "bonusSolve") {
    await ctx.deadline.clear();
  }

  const payload: ChangedPayload = { step: next.step, phase: next.phase, turnId: next.turnId };
  await ctx.broadcast("changed", payload);

  if (next.phase === "over") {
    await ctx.finish();
    await ctx.notify("others", { title: `${GAME} finished!`, body: "The money's counted — come see who won!" });
    return { ...view, finished: true };
  }
  if (next.phase === "bonusPick" && before.phase !== "bonusPick") {
    await ctx.notify(next.turnId, { title: "Bonus round!", body: "You're playing for the big prize." });
  } else if (next.turnId !== before.turnId && next.turnId !== ctx.viewer?.id) {
    await ctx.notify(next.turnId, { title: "Your turn!", body: "The discus is yours." });
  }
  return view;
}

async function load(ctx: Ctx) {
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Game state missing");
  return stored.data;
}

export const plugin = defineGame<DiscusContent, DiscusState>({
  gameType: "discus_of_wealth",
  displayName: GAME,
  description: "Spin the discus, call letters and solve the puzzle before your friends do",
  minPlayers: 2,
  maxPlayers: 6,
  supportsRandomize: true,
  randomizeText: { label: "Randomize turn order", description: "Who spins first, and the order after, is shuffled" },
  timer: { options: [15, 30, 60], label: "Time per turn" },

  async getLobbyMeta(ctx) {
    return { subtitle: describe(ctx.session.content.data) };
  },

  async start(ctx, { randomize }) {
    const ids = ctx.session.players.map((p) => p.id);
    const order = randomize ? shuffle(ids) : ids;
    const state = freshState(order, pickPuzzles(ctx.session.content.data.rounds));
    await ctx.state.init(state);
    if (ctx.session.timerSeconds) await ctx.deadline.set(ctx.session.timerSeconds * 1000, `turn:${state.step}`);
    return { firstPlayerId: state.turnId };
  },

  // Sent to players and spectators alike; viewFor keeps the puzzle out.
  async buildPlayProps(ctx) {
    return { title: ctx.session.content.title, initialView: viewFor(await load(ctx), ctx.viewer?.id ?? null) };
  },

  async onDeadline(ctx, key) {
    await apply(ctx, (state) => {
      if (key === "bonus") return state.phase === "bonusSolve" ? endBonus(state, false) : state;
      if (key === `turn:${state.step}` && timed(state)) return passTurn(state, { kind: "timeout", playerId: state.turnId });
      return state;
    });
  },

  // Play goes on without them; with one player left the game ends, unless
  // they are the one playing the bonus round.
  async onPlayerLeft(ctx, { playerId }) {
    const state = await load(ctx);
    const bonusPlayerStays = isBonus(state) && state.bonus!.playerId !== playerId;
    if (isBonus(state) && !bonusPlayerStays) {
      await apply(ctx, (s) => (isBonus(s) ? endBonus(s, false) : s));
      return;
    }
    if (ctx.session.players.length < 2 && !bonusPlayerStays) {
      await ctx.finish();
      return;
    }
    await apply(ctx, (s) => withoutPlayer(s, playerId));
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyone = [...ctx.session.players, ...ctx.session.leftPlayers];
    const name = (id: string | null) => everyone.find((p) => p.id === id)?.username ?? "Nobody";
    const standings = ctx.session.players
      .map((p) => ({ playerId: p.id, player: p.username, total: state?.banks[p.id] ?? 0 }))
      .sort((a, b) => b.total - a.total);
    const rounds = (state?.history ?? []).map((record) => {
      const { category, puzzle } = getPuzzle(record.puzzleId);
      return { category, puzzle, winner: name(record.winnerId), won: record.won };
    });
    const bonus =
      state?.bonus && state.bonus.won !== null
        ? {
            player: name(state.bonus.playerId),
            category: getPuzzle(state.bonusPuzzleId!).category,
            puzzle: getPuzzle(state.bonusPuzzleId!).puzzle,
            picks: state.bonus.picks,
            won: state.bonus.won,
          }
        : null;
    return { title: ctx.session.content.title, standings, rounds, bonus };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      handler: async (ctx) =>
        (await ctx.content.list({ limit: 20 })).map((game) => ({
          id: game.id,
          title: game.title,
          rounds: game.data.rounds,
          bonus: game.data.bonus,
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, data: z.infer<typeof CreateSchema>) => {
        const game = await ctx.content.create({ title: `${GAME} — ${describe(data)}`, data });
        return { id: game.id };
      },
    },
  },

  sessionActions: {
    spin: {
      access: "player",
      handler: async (ctx) => {
        // Chosen once, outside apply, so a retried write lands on the same wedge.
        const wedge = Math.floor(Math.random() * WEDGE_COUNT);
        return apply(ctx, (state) => spin(state, ctx.viewer!.id, wedge));
      },
    },

    consonant: {
      access: "player",
      input: LetterSchema,
      handler: async (ctx, { letter }: z.infer<typeof LetterSchema>) =>
        apply(ctx, (state) => callConsonant(state, ctx.viewer!.id, letter)),
    },

    vowel: {
      access: "player",
      input: LetterSchema,
      handler: async (ctx, { letter }: z.infer<typeof LetterSchema>) =>
        apply(ctx, (state) => buyVowel(state, ctx.viewer!.id, letter)),
    },

    solve: {
      access: "player",
      input: SolveSchema,
      handler: async (ctx, { guess }: z.infer<typeof SolveSchema>) =>
        apply(ctx, (state) => solve(state, ctx.viewer!.id, guess)),
    },

    bonusPick: {
      access: "player",
      input: BonusPickSchema,
      handler: async (ctx, { consonants, vowel }: z.infer<typeof BonusPickSchema>) =>
        apply(ctx, (state) => bonusPick(state, ctx.viewer!.id, consonants, vowel)),
    },

    bonusSolve: {
      access: "player",
      input: SolveSchema,
      handler: async (ctx, { guess }: z.infer<typeof SolveSchema>) =>
        apply(ctx, (state) => bonusSolve(state, ctx.viewer!.id, guess)),
    },

    /** From the solved board: on to the next round, the bonus round, or the end. */
    next: {
      access: "player",
      input: StepSchema,
      handler: async (ctx, { step }: z.infer<typeof StepSchema>) => {
        const bonus = ctx.session.content.data.bonus;
        // Someone else already moved the game on: apply() just shows where it is now.
        return apply(ctx, (state) => {
          if (state.step !== step || state.phase !== "solved") return state;
          if (!isLastRound(state)) return nextRound(state);
          return bonus ? startBonus(state) : { ...state, phase: "over" };
        });
      },
    },

    /** Host only: stop waiting for a player who has gone quiet. */
    skip: {
      access: "host",
      input: StepSchema,
      handler: async (ctx, { step }: z.infer<typeof StepSchema>) =>
        apply(ctx, (state) => {
          if (state.step !== step) return state;
          if (timed(state)) return passTurn(state, { kind: "skipped", playerId: state.turnId });
          if (isBonus(state)) return endBonus(state, false);
          throw new GameError(400, "Nothing to skip");
        }),
    },

    /** The game as this viewer may see it — for a browser catching up. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => viewFor(await load(ctx), ctx.viewer?.id ?? null),
    },
  },

  PlayComponent: DiscusBoard,
  RevealComponent: DiscusReveal,
  BrowsePage,
});
