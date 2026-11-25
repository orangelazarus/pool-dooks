import type { z } from "zod";
import { Disc3 } from "lucide-react";
import { defineGame, GameError, shuffle, type SessionContext } from "@/lib/game-sdk";
import {
  BonusPickSchema,
  CreateSchema,
  LetterSchema,
  SolveSchema,
  StepSchema,
  NPC_TABLE_SIZE,
  type ChangedPayload,
  type DiscusContent,
  type DiscusState,
  type NpcLevel,
} from "./schema";
import { isNpc, makeNpcs, npcDelay, npcTurn, seeded } from "./npc";
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
const LEVEL_NAMES: Record<NpcLevel, string> = { easy: "Easy", medium: "Medium", hard: "Hard" };
const describe = (data: DiscusContent) =>
  `${data.rounds} puzzles${data.bonus ? " + bonus round" : ""}${data.computers ? ` · computer players (${LEVEL_NAMES[data.computers]})` : ""}`;

const levelOf = (ctx: Ctx): NpcLevel => ctx.session.content.data.computers ?? "medium";
/** The deadline that has a computer player move. Names the step, so a stale one does nothing. */
const npcKey = (state: DiscusState) => `npc:${state.step}`;
/** Whether a computer player is due to move (so an npc deadline may be pending). */
const npcToMove = (state: DiscusState) => isNpc(state, state.turnId) && state.phase !== "solved" && state.phase !== "over";

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

  // Core's turn only knows real players; while a computer plays it stays with the last person.
  if (next.turnId !== before.turnId && !isNpc(next, next.turnId)) await ctx.turn.set(next.turnId);

  const timer = ctx.session.timerSeconds;
  const wait = npcDelay(next, levelOf(ctx), Math.random);
  if (wait !== null) {
    await ctx.deadline.set(wait, npcKey(next));
  } else if (next.phase === "bonusSolve" && before.phase !== "bonusSolve") {
    await ctx.deadline.set(BONUS_SECONDS * 1000, "bonus");
  } else if (timer && timed(next)) {
    // Every move earns fresh time; the key names the step, so a stale deadline does nothing.
    await ctx.deadline.set(timer * 1000, `turn:${next.step}`);
  } else if ((timer && timed(before)) || before.phase === "bonusSolve" || npcToMove(before)) {
    await ctx.deadline.clear();
  }

  const payload: ChangedPayload = { step: next.step, phase: next.phase, turnId: next.turnId };
  await ctx.broadcast("changed", payload);

  if (next.phase === "over") {
    await ctx.finish();
    await ctx.notify("others", { title: `${GAME} finished!`, body: "The money's counted — come see who won!" });
    return { ...view, finished: true };
  }
  if (isNpc(next, next.turnId)) {
    // Computers need no push.
  } else if (next.phase === "bonusPick" && before.phase !== "bonusPick") {
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
  icon: Disc3,
  description: "Spin the discus, call letters and solve the puzzle before your friends do",
  // One is a game against computer players; without them, start() waits for a second person.
  minPlayers: 1,
  maxPlayers: 6,
  supportsRandomize: true,
  randomizeText: { label: "Randomize turn order", description: "Who spins first, and the order after, is shuffled" },
  timer: { options: [15, 30, 60], label: "Time per turn" },

  async getLobbyMeta(ctx) {
    return { subtitle: describe(ctx.session.content.data) };
  },

  async start(ctx, { randomize }) {
    const { rounds, computers } = ctx.session.content.data;
    const ids = ctx.session.players.map((p) => p.id);
    if (!computers && ids.length < 2) throw new GameError(400, "Waiting for another player — or turn on computer players");
    // Computers fill the empty seats up to NPC_TABLE_SIZE; a bigger group plays on its own.
    const npcs = computers ? makeNpcs(Math.max(0, NPC_TABLE_SIZE - ids.length)) : {};
    const seats = [...ids, ...Object.keys(npcs)];
    const order = randomize ? shuffle(seats) : seats;
    const state: DiscusState = { ...freshState(order, pickPuzzles(rounds)), ...(Object.keys(npcs).length > 0 && { npcs }) };
    await ctx.state.init(state);
    const wait = npcDelay(state, levelOf(ctx), Math.random);
    if (wait !== null) await ctx.deadline.set(wait, npcKey(state));
    else if (ctx.session.timerSeconds) await ctx.deadline.set(ctx.session.timerSeconds * 1000, `turn:${state.step}`);
    // Core's turn must be a person: if a computer opens, the first person in the order.
    return { firstPlayerId: isNpc(state, state.turnId) ? order.find((id) => !isNpc(state, id))! : state.turnId };
  },

  // Sent to players and spectators alike; viewFor keeps the puzzle out.
  async buildPlayProps(ctx) {
    return { title: ctx.session.content.title, initialView: viewFor(await load(ctx), ctx.viewer?.id ?? null) };
  },

  async onDeadline(ctx, key) {
    if (key.startsWith("npc:")) {
      // Chosen once, outside apply, so a retried write makes the same move.
      const seed = Math.random();
      const wedge = Math.floor(Math.random() * WEDGE_COUNT);
      await apply(ctx, (state) =>
        key === npcKey(state) && npcToMove(state) ? npcTurn(state, levelOf(ctx), seeded(seed), wedge) : state
      );
      return;
    }
    await apply(ctx, (state) => {
      if (key === "bonus") return state.phase === "bonusSolve" ? endBonus(state, false) : state;
      if (key === `turn:${state.step}` && timed(state)) return passTurn(state, { kind: "timeout", playerId: state.turnId });
      return state;
    });
  },

  // Play goes on without them; with one player left the game ends, unless
  // they are the one playing the bonus round. Computers don't play on alone.
  async onPlayerLeft(ctx, { playerId }) {
    const state = await load(ctx);
    if (ctx.session.players.length === 0) {
      await ctx.finish();
      return;
    }
    const bonusPlayerStays = isBonus(state) && state.bonus!.playerId !== playerId;
    if (isBonus(state) && !bonusPlayerStays) {
      await apply(ctx, (s) => (isBonus(s) ? endBonus(s, false) : s));
      return;
    }
    const seats = ctx.session.players.length + Object.keys(state.npcs ?? {}).length;
    if (seats < 2 && !bonusPlayerStays) {
      await ctx.finish();
      return;
    }
    await apply(ctx, (s) => withoutPlayer(s, playerId));
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyone = [...ctx.session.players, ...ctx.session.leftPlayers];
    const npcs = state?.npcs ?? {};
    const name = (id: string | null) =>
      (id && Object.hasOwn(npcs, id) ? `${npcs[id]} (computer)` : everyone.find((p) => p.id === id)?.username) ?? "Nobody";
    const seated = [...ctx.session.players.map((p) => p.id), ...Object.keys(npcs)];
    const standings = seated
      .map((id) => ({ playerId: id, player: name(id), total: state?.banks[id] ?? 0 }))
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
          computers: game.data.computers ?? null,
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
