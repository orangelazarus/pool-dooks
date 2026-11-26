import type { z } from "zod";
import { Brush } from "lucide-react";
import { defineGame, GameError, shuffle, type SessionContext } from "@/lib/game-sdk";
import {
  CreateSchema,
  MAX_TEXT,
  MIN_TEXT,
  SkipSchema,
  STEP_OPTIONS,
  stepsLabel,
  SubmitSchema,
  type EpycContent,
  type EpycState,
  type Entry,
} from "./schema";
import { decodeDrawing, hasInk } from "./drawing";
import {
  addEntry,
  cleanText,
  closeRound,
  freshState,
  isComplete,
  maybeAdvance,
  removePlayer,
  skipTasks,
  taskKind,
  tasksFor,
  viewFor,
} from "./rules";
import { EpycBoard } from "./components/EpycBoard";
import { EpycReveal } from "./components/EpycReveal";
import BrowsePage from "./pages/BrowsePage";

type Ctx = SessionContext<EpycContent, EpycState>;

const TITLE = "Eat Poop You Cat";

async function load(ctx: Ctx) {
  const stored = await ctx.state.get();
  if (!stored) throw new GameError(500, "Game state missing");
  return stored.data;
}

const playerIds = (ctx: Ctx) => ctx.session.players.map((p) => p.id);
const view = (ctx: Ctx, state: EpycState) => viewFor(state, playerIds(ctx), ctx.viewer?.id ?? null);
const roundKey = (round: number) => `round:${round}`;
const describe = (data: EpycContent) => stepsLabel(STEP_OPTIONS.includes(data.steps) ? data.steps : "full");

/**
 * Applies `change` to the latest state and deals with what follows: the next
 * live turn's clock, pushes to players a book just reached, and the end of the
 * game. `change` must depend only on the state — it runs again if another
 * player's write lands first — and refuses a request by throwing a GameError.
 * Returns the new state, and whether the game is now over.
 */
async function apply(ctx: Ctx, change: (state: EpycState) => EpycState) {
  let before: EpycState | undefined;
  const { data: next, changed } = await ctx.state.mutate((state) => {
    before = state;
    return change(state);
  });
  if (!changed || !before) return { state: next, finished: false };

  await ctx.broadcast("changed", {});
  const others = playerIds(ctx).filter((id) => id !== ctx.viewer?.id);

  if (isComplete(next)) {
    if (next.mode === "live") await ctx.deadline.clear();
    await ctx.finish();
    await ctx.notify(others, { title: TITLE, body: "Every book is finished — come see how they turned out!" });
    return { state: next, finished: true };
  }

  if (next.mode === "live") {
    if (next.round !== before.round && ctx.session.timerSeconds) {
      await ctx.deadline.set(ctx.session.timerSeconds * 1000, roundKey(next.round));
    }
  } else {
    // Only when someone's queue goes from empty to not: one push per wait, not per book.
    for (const id of others) {
      const waiting = tasksFor(next, id);
      if (tasksFor(before, id).length === 0 && waiting.length > 0) {
        const kind = taskKind(waiting[0]);
        const body =
          kind === "draw"
            ? "A book was passed to you — your turn to draw."
            : kind === "describe"
              ? "A book was passed to you — what's in this drawing?"
              : "A book was passed to you — write something to start it.";
        await ctx.notify([id], { title: TITLE, body });
      }
    }
  }
  return { state: next, finished: false };
}

export const plugin = defineGame<EpycContent, EpycState>({
  gameType: "eat_poop_you_cat",
  displayName: TITLE,
  icon: Brush,
  description: "Telephone with pictures: write, draw, describe, draw — then see how far it drifted",
  minPlayers: 3,
  // Every drawing lives in one game-state row; eight players' books fit with room to spare.
  maxPlayers: 8,
  timer: { options: [60, 90, 120, 180], label: "Time per turn" },

  async getLobbyMeta(ctx) {
    return {
      subtitle: `${describe(ctx.session.content.data)} · ${ctx.session.timerSeconds ? `live, ${ctx.session.timerSeconds}s a turn` : "at your own pace"}`,
    };
  },

  async start(ctx) {
    const live = ctx.session.timerSeconds !== null;
    await ctx.state.init(freshState(shuffle(playerIds(ctx)), ctx.session.content.data, live ? "live" : "async"));
    if (live) await ctx.deadline.set(ctx.session.timerSeconds! * 1000, roundKey(0));
  },

  // Rendered for one viewer, so it carries only their own task.
  async buildPlayProps(ctx) {
    const state = await load(ctx);
    return { title: ctx.session.content.title, initialView: view(ctx, state) };
  },

  async onDeadline(ctx, key) {
    await apply(ctx, (state) => (state.mode === "live" && key === roundKey(state.round) ? closeRound(state) : state));
  },

  async onPlayerLeft(ctx, { playerId }) {
    if (ctx.session.players.length < 2) {
      await ctx.finish();
      return;
    }
    await apply(ctx, (state) => removePlayer(state, playerId));
  },

  async buildResult(ctx) {
    const state = (await ctx.state.get())?.data;
    const everyone = [...ctx.session.players, ...ctx.session.leftPlayers];
    const name = (id: string) => everyone.find((p) => p.id === id)?.username ?? "Someone";
    const books = (state?.books ?? [])
      .filter((b) => b.entries.some((e) => e.kind !== "skipped"))
      .map((b) => ({
        id: b.id,
        owner: name(b.ownerId),
        entries: b.entries.map((e) => ({ ...e, by: name(e.by) })),
      }));
    return { title: ctx.session.content.title, books };
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
        const game = await ctx.content.create({ title: `${TITLE} — ${describe(data)}`, data });
        return { id: game.id };
      },
    },
  },

  sessionActions: {
    submit: {
      access: "player",
      input: SubmitSchema,
      handler: async (ctx, input: z.infer<typeof SubmitSchema>) => {
        const me = ctx.viewer!.id;
        let entry: Entry;
        if (input.drawing !== undefined) {
          const strokes = decodeDrawing(input.drawing);
          if (!strokes) throw new GameError(400, "That drawing couldn't be read");
          if (!hasInk(strokes)) throw new GameError(400, "Draw something first");
          entry = { kind: "drawing", drawing: input.drawing, by: me };
        } else if (input.text !== undefined) {
          entry = { kind: "text", text: cleanText(input.text, MIN_TEXT, MAX_TEXT), by: me };
        } else {
          throw new GameError(400, "Nothing to hand in");
        }
        const { state, finished } = await apply(ctx, (s) => maybeAdvance(addEntry(s, input.bookId, input.step, me, entry)));
        return { ...view(ctx, state), finished };
      },
    },

    /** Host only: stop waiting on a player, skipping whatever books are waiting for them. */
    skip: {
      access: "host",
      input: SkipSchema,
      handler: async (ctx, { playerId }: z.infer<typeof SkipSchema>) => {
        if (!playerIds(ctx).includes(playerId)) throw new GameError(400, "They aren't in this game");
        const { state, finished } = await apply(ctx, (s) => {
          if (tasksFor(s, playerId).length === 0) throw new GameError(400, "Nothing is waiting for them");
          return maybeAdvance(skipTasks(s, playerId));
        });
        return { ...view(ctx, state), finished };
      },
    },

    /** The game as this viewer may see it — for a browser catching up. */
    state: {
      method: "GET",
      access: "viewer",
      handler: async (ctx) => view(ctx, await load(ctx)),
    },
  },

  PlayComponent: EpycBoard,
  RevealComponent: EpycReveal,
  BrowsePage,
});
