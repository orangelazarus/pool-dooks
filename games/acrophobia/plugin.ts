import type { z } from "zod";
import { defineGame, GameError, type SessionContext } from "@/lib/game-sdk";
import {
  AnswerSchema,
  CATEGORY_MODE_LABELS,
  ChooseSchema,
  CreateSchema,
  StepSchema,
  VoteSchema,
  type AcroContent,
  type AcroState,
  type ChangedPayload,
} from "./schema";
import { misfit, tidy } from "./acronym";
import {
  actedIds,
  anyCategory,
  champions,
  chooseCategory,
  closeRound,
  freshState,
  isOver,
  nextRound,
  openVoting,
  viewFor,
  voterIds,
  writerIds,
} from "./rules";
import { AcroBoard } from "./components/AcroBoard";
import { AcroReveal } from "./components/AcroReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<AcroContent, AcroState>;

// A host may close a phase early once this many players have acted. The
// face-off has only two writers, so one answer is enough there.
const MIN_ANSWERS_TO_SKIP = 2;
const MIN_FACEOFF_ANSWERS_TO_SKIP = 1;
const MIN_VOTES_TO_SKIP = 1;

async function load(ctx: Ctx) {
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Game state missing");
  return { state: stored.data, version: stored.version };
}

const playerIds = (ctx: Ctx) => ctx.session.players.map((p) => p.id);
const everyone = (expected: string[], acted: string[]) => expected.every((id) => acted.includes(id));
const view = (ctx: Ctx, state: AcroState) =>
  viewFor(state, ctx.session.content.data, playerIds(ctx), ctx.viewer?.id ?? null);

const describe = (data: AcroContent) =>
  `First to ${data.target} · ${data.faceoffRounds} face-off round${data.faceoffRounds === 1 ? "" : "s"} · ${CATEGORY_MODE_LABELS[data.categories].toLowerCase()}`;

const PHASE_PUSH: Record<AcroState["phase"], string> = {
  choosing: "New round — the last winner is picking a category.",
  writing: "New acronym — time to write!",
  voting: "The answers are in — vote for your favourite.",
  results: "The votes are in — see who won the round!",
};

/** Opens voting once every writer has answered. */
function maybeOpenVoting(ctx: Ctx, state: AcroState): AcroState {
  return everyone(writerIds(state, playerIds(ctx)), Object.keys(state.answers)) ? openVoting(state) : state;
}

/**
 * Applies `change` to the latest state, nudges every open browser, and returns
 * the caller's view. `change` must not depend on anything but the state — it
 * runs again if another player's write lands first — and refuses a request by
 * throwing a GameError.
 */
async function apply(ctx: Ctx, change: (state: AcroState) => AcroState) {
  let before: AcroState | undefined;
  const { data: next, changed } = await ctx.state.mutate((state) => {
    before = state;
    return change(state);
  });
  if (changed) {
    const payload: ChangedPayload = { round: next.round, phase: next.phase, actedIds: actedIds(next) };
    await ctx.broadcast("changed", payload);
    if (next.phase !== before?.phase || next.round !== before?.round) {
      await ctx.notify("others", { title: "Acrophobia", body: PHASE_PUSH[next.phase] });
    }
  }
  return view(ctx, next);
}

/** Moves the game on if everyone it's waiting for has acted, or has gone. */
function settle(ctx: Ctx, state: AcroState): AcroState {
  const ids = playerIds(ctx);
  if (state.phase === "choosing" && !ids.includes(state.chooserId ?? "")) return chooseCategory(state, anyCategory());
  if (state.phase === "writing") return maybeOpenVoting(ctx, state);
  if (state.phase === "voting" && everyone(voterIds(state, ids), Object.keys(state.votes))) return closeRound(state);
  return state;
}

export const plugin = defineGame<AcroContent, AcroState>({
  gameType: "acrophobia",
  displayName: "Acrophobia",
  description: "Turn a random acronym into the funniest phrase you can — then vote for your favourite",
  // Face-off voting needs someone who isn't in it.
  minPlayers: 3,
  maxPlayers: 12,

  async getLobbyMeta(ctx) {
    return { subtitle: describe(ctx.session.content.data) };
  },

  async start(ctx) {
    await ctx.state.init(freshState(ctx.session.content.data));
  },

  // Sent to players and spectators alike; viewFor keeps the secrets out.
  async buildPlayProps(ctx) {
    const { state } = await load(ctx);
    return { title: ctx.session.content.title, initialView: view(ctx, state) };
  },

  async onPlayerLeft(ctx, { playerId }) {
    const { state } = await load(ctx);
    // A finalist walking out hands the face-off to the other one.
    if (state.stage === "faceoff" && state.finalists?.includes(playerId)) {
      await ctx.state.mutate((s) => ({ ...s, forfeit: playerId }));
      await ctx.finish();
      return;
    }
    // The face-off needs a judge who isn't in it: below three, the main game decides.
    if (ctx.session.players.length < 3) {
      await ctx.finish();
      return;
    }
    await apply(ctx, (s) => settle(ctx, s));
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyonePlayed = [...ctx.session.players, ...ctx.session.leftPlayers];
    const name = (id: string) => everyonePlayed.find((p) => p.id === id)?.username ?? "Someone";
    const standings = everyonePlayed
      .map((p) => ({ playerId: p.id, player: p.username, score: state?.scores[p.id] ?? 0 }))
      .sort((a, b) => b.score - a.score);
    const finalists = (state?.finalists ?? []).map((id) => ({
      player: name(id),
      forfeited: state?.forfeit === id,
      faceoff: state?.faceoffScores[id] ?? 0,
      score: state?.scores[id] ?? 0,
    }));
    const rounds = (state?.history ?? []).map((record) => ({
      stage: record.stage,
      acronym: record.acronym,
      category: record.category,
      entries: record.entries
        .map((e) => ({
          text: e.text,
          author: name(e.authorId),
          votes: Object.values(record.votes).filter((id) => id === e.id).length,
          won: e.id === record.winnerEntryId,
        }))
        .sort((a, b) => b.votes - a.votes),
    }));
    return {
      title: ctx.session.content.title,
      champions: state ? champions(state).map(name) : [],
      finalists,
      standings,
      rounds,
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
          summary: describe(game.data),
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, data: z.infer<typeof CreateSchema>) => {
        const game = await ctx.content.create({ title: `Acrophobia — first to ${data.target}`, data });
        return { id: game.id };
      },
    },
  },

  sessionActions: {
    choose: {
      access: "player",
      input: ChooseSchema,
      handler: async (ctx, { category }: z.infer<typeof ChooseSchema>) => {
        const me = ctx.viewer!.id;
        return apply(ctx, (state) => {
          if (state.phase !== "choosing") throw new GameError(400, "The category has already been picked");
          if (state.chooserId !== me) throw new GameError(403, "It's not your pick");
          return chooseCategory(state, tidy(category));
        });
      },
    },

    answer: {
      access: "player",
      input: AnswerSchema,
      handler: async (ctx, { text }: z.infer<typeof AnswerSchema>) => {
        const me = ctx.viewer!.id;
        // Taken once, so a retry after a write collision doesn't make the answer slower.
        const arrived = Date.now();
        return apply(ctx, (state) => {
          if (state.phase !== "writing") throw new GameError(400, "It's too late to answer this one");
          if (!writerIds(state, playerIds(ctx)).includes(me)) throw new GameError(403, "Only the finalists write in the face-off");
          if (state.answers[me]) throw new GameError(400, "You've already answered");
          const problem = misfit(state.acronym, text);
          if (problem) throw new GameError(400, problem);

          const answer = { text: tidy(text), at: Math.max(0, arrived - state.openedAt) };
          return maybeOpenVoting(ctx, { ...state, answers: { ...state.answers, [me]: answer } });
        });
      },
    },

    vote: {
      access: "player",
      input: VoteSchema,
      handler: async (ctx, { entryId }: z.infer<typeof VoteSchema>) => {
        const me = ctx.viewer!.id;
        return apply(ctx, (state) => {
          if (state.phase !== "voting") throw new GameError(400, "There's nothing to vote on right now");
          if (!voterIds(state, playerIds(ctx)).includes(me)) throw new GameError(403, "Finalists don't vote in the face-off");
          if (state.votes[me]) throw new GameError(400, "You've already voted");
          const entry = state.entries.find((e) => e.id === entryId);
          if (!entry) throw new GameError(400, "That isn't one of the answers");
          if (entry.authorId === me) throw new GameError(400, "You can't vote for your own answer");

          return settle(ctx, { ...state, votes: { ...state.votes, [me]: entryId } });
        });
      },
    },

    /** From the results: on to the next round, the face-off, or the end of the game. */
    next: {
      access: "player",
      input: StepSchema,
      handler: async (ctx, step: z.infer<typeof StepSchema>) => {
        const content = ctx.session.content.data;
        const { state } = await load(ctx);
        // Someone else already moved the game on: apply() just shows where it is now.
        const current = (s: AcroState) => step.round === s.round && s.phase === "results";

        if (current(state) && isOver(state, content)) {
          await ctx.finish();
          await ctx.notify("others", { title: "Acrophobia finished!", body: "The face-off is over — come see who won!" });
          return { ...view(ctx, state), finished: true };
        }
        return apply(ctx, (s) => (current(s) ? nextRound(s, content, playerIds(ctx)) : s));
      },
    },

    /** Host only: stop waiting for whoever hasn't acted. */
    skip: {
      access: "host",
      input: StepSchema,
      handler: async (ctx, step: z.infer<typeof StepSchema>) => {
        return apply(ctx, (state) => {
          if (step.round !== state.round || step.phase !== state.phase) return state;

          if (state.phase === "choosing") {
            return chooseCategory(state, anyCategory());
          }
          if (state.phase === "writing") {
            const needed = state.stage === "faceoff" ? MIN_FACEOFF_ANSWERS_TO_SKIP : MIN_ANSWERS_TO_SKIP;
            if (Object.keys(state.answers).length < needed) {
              throw new GameError(400, `Wait for at least ${needed} answer${needed === 1 ? "" : "s"} first`);
            }
            return openVoting(state);
          }
          if (state.phase === "voting") {
            if (Object.keys(state.votes).length < MIN_VOTES_TO_SKIP) throw new GameError(400, "Wait for at least one vote first");
            return closeRound(state);
          }
          throw new GameError(400, "Nothing to skip");
        });
      },
    },

    /** The game as this viewer may see it — for a browser catching up. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => {
        const { state } = await load(ctx);
        return view(ctx, state);
      },
    },
  },

  PlayComponent: AcroBoard,
  RevealComponent: AcroReveal,
  BrowsePage,
});
