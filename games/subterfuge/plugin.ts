import type { z } from "zod";
import { defineGame, GameError, type SessionContext } from "@/lib/game-sdk";
import {
  CreateSchema,
  LieSchema,
  PickSchema,
  StepSchema,
  type ChangedPayload,
  type SubterfugeContent,
  type SubterfugeState,
} from "./schema";
import { QUESTIONS } from "./questions";
import {
  actedIds,
  clean,
  closeRound,
  freshState,
  getQuestion,
  isLastRound,
  isTruth,
  nextRound,
  openGuessing,
  viewFor,
} from "./rules";
import { SubterfugeBoard } from "./components/SubterfugeBoard";
import { SubterfugeReveal } from "./components/SubterfugeReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<SubterfugeContent, SubterfugeState>;

// A host may close a phase early once this many players have acted.
const MIN_LIES_TO_SKIP = 2;
const MIN_PICKS_TO_SKIP = 1;

async function load(ctx: Ctx) {
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Game state missing");
  return { state: stored.data, version: stored.version };
}

const everyone = (ctx: Ctx, ids: string[]) => ctx.session.players.every((p) => ids.includes(p.id));

/** Saves the new state, nudges every open browser, and returns the caller's view of it. */
async function commit(ctx: Ctx, next: SubterfugeState, version: number) {
  await ctx.state.update(next, { expectedVersion: version });
  const payload: ChangedPayload = { round: next.round, phase: next.phase, actedIds: actedIds(next) };
  await ctx.broadcast("changed", payload);
  return viewFor(next, ctx.viewer!.id);
}

async function announceGuessing(ctx: Ctx) {
  await ctx.notify("others", { title: "Subterfuge", body: "The lies are in — can you spot the truth?" });
}

async function announceResults(ctx: Ctx) {
  await ctx.notify("others", { title: "Subterfuge", body: "Everyone has guessed — see who fooled who!" });
}

export const plugin = defineGame<SubterfugeContent, SubterfugeState>({
  gameType: "subterfuge",
  displayName: "Subterfuge",
  description: "Write a lie convincing enough to fool your friends — then find the truth among theirs",
  minPlayers: 2,
  maxPlayers: 8,

  async getLobbyMeta(ctx) {
    return { subtitle: `${ctx.session.content.data.rounds} questions` };
  },

  async start(ctx) {
    await ctx.state.init(freshState(Math.min(ctx.session.content.data.rounds, QUESTIONS.length)));
  },

  // Sent to players and spectators alike; viewFor keeps the secrets out.
  async buildPlayProps(ctx) {
    const { state } = await load(ctx);
    return { title: ctx.session.content.title, initialView: viewFor(state, ctx.viewer?.id ?? null) };
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const name = (id: string) => ctx.session.players.find((p) => p.id === id)?.username ?? "Someone";
    const standings = ctx.session.players
      .map((p) => ({ playerId: p.id, player: p.username, score: state?.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const rounds = (state?.history ?? []).map((record) => {
      const question = getQuestion(record.questionId);
      return {
        prompt: question.prompt,
        answer: question.answer,
        choices: record.choices.map((c) => ({
          text: c.text,
          isTruth: c.isTruth,
          authors: c.authorIds.map(name),
          pickers: Object.keys(record.picks)
            .filter((playerId) => record.picks[playerId] === c.id)
            .map(name),
        })),
      };
    });
    return { title: ctx.session.content.title, standings, rounds };
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
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, { rounds }: z.infer<typeof CreateSchema>) => {
        const game = await ctx.content.create({ title: `Subterfuge — ${rounds} questions`, data: { rounds } });
        return { id: game.id };
      },
    },
  },

  sessionActions: {
    lie: {
      access: "player",
      input: LieSchema,
      handler: async (ctx, { text }: z.infer<typeof LieSchema>) => {
        const { state, version } = await load(ctx);
        const me = ctx.viewer!.id;
        if (state.phase !== "lying") throw new GameError(400, "It's too late to write a lie for this question");
        if (state.lies[me]) throw new GameError(400, "You've already written your lie");
        if (isTruth(getQuestion(state.questionIds[state.round]), text)) {
          throw new GameError(400, "That's the actual answer! Write a lie instead.");
        }

        let next: SubterfugeState = { ...state, lies: { ...state.lies, [me]: clean(text) } };
        if (everyone(ctx, Object.keys(next.lies))) {
          next = openGuessing(next);
          await announceGuessing(ctx);
        }
        return commit(ctx, next, version);
      },
    },

    pick: {
      access: "player",
      input: PickSchema,
      handler: async (ctx, { choiceId }: z.infer<typeof PickSchema>) => {
        const { state, version } = await load(ctx);
        const me = ctx.viewer!.id;
        if (state.phase !== "guessing") throw new GameError(400, "There's nothing to pick right now");
        if (state.picks[me]) throw new GameError(400, "You've already picked");
        const choice = state.choices.find((c) => c.id === choiceId);
        if (!choice) throw new GameError(400, "That isn't one of the choices");
        if (choice.authorIds.includes(me)) throw new GameError(400, "You can't pick your own lie");

        let next: SubterfugeState = { ...state, picks: { ...state.picks, [me]: choiceId } };
        if (everyone(ctx, Object.keys(next.picks))) {
          next = closeRound(next);
          await announceResults(ctx);
        }
        return commit(ctx, next, version);
      },
    },

    /** From the results: on to the next question, or the end of the game. */
    next: {
      access: "player",
      input: StepSchema,
      handler: async (ctx, step: z.infer<typeof StepSchema>) => {
        const { state, version } = await load(ctx);
        const me = ctx.viewer!.id;
        // Someone else already moved the game on: just show where it is now.
        if (step.round !== state.round || state.phase !== "results") return viewFor(state, me);

        if (isLastRound(state)) {
          await ctx.finish();
          await ctx.notify("others", { title: "Subterfuge finished!", body: "The final scores are in — come see who won!" });
          return { ...viewFor(state, me), finished: true };
        }
        await ctx.notify("others", { title: "Subterfuge", body: "Next question — time to write a lie." });
        return commit(ctx, nextRound(state), version);
      },
    },

    /** Host only: stop waiting for whoever hasn't acted. */
    skip: {
      access: "player",
      input: StepSchema,
      handler: async (ctx, step: z.infer<typeof StepSchema>) => {
        const { state, version } = await load(ctx);
        const me = ctx.viewer!.id;
        if (me !== ctx.session.hostId) throw new GameError(403, "Only the host can skip ahead");
        if (step.round !== state.round || step.phase !== state.phase) return viewFor(state, me);

        if (state.phase === "lying") {
          if (Object.keys(state.lies).length < MIN_LIES_TO_SKIP) {
            throw new GameError(400, `Wait for at least ${MIN_LIES_TO_SKIP} lies first`);
          }
          await announceGuessing(ctx);
          return commit(ctx, openGuessing(state), version);
        }
        if (state.phase === "guessing") {
          if (Object.keys(state.picks).length < MIN_PICKS_TO_SKIP) {
            throw new GameError(400, "Wait for at least one guess first");
          }
          await announceResults(ctx);
          return commit(ctx, closeRound(state), version);
        }
        throw new GameError(400, "Nothing to skip");
      },
    },

    /** The game as this viewer may see it — for a browser catching up. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => {
        const { state } = await load(ctx);
        return viewFor(state, ctx.viewer?.id ?? null);
      },
    },
  },

  PlayComponent: SubterfugeBoard,
  RevealComponent: SubterfugeReveal,
  BrowsePage,
});
