import type { z } from "zod";
import { defineGame, GameError } from "@/lib/game-sdk";
import { CreateSchema, type NumberGameContent } from "./schema";
import { NumberGameBoard } from "./components/NumberGameBoard";
import { NumberGameReveal } from "./components/NumberGameReveal";
import BrowsePage from "./pages/BrowsePage";

// Runs on the shared turn engine: one "guess_<playerId>" token per player, and
// guesses are submitted through core's answer route. No session state of its own.
export const plugin = defineGame<NumberGameContent>({
  gameType: "guess_the_number",
  displayName: "Guess the Number",
  description: "Everyone guesses a secret number — closest wins",
  minPlayers: 2,
  maxPlayers: 16,

  async getLobbyMeta(ctx) {
    const { minNumber, maxNumber } = ctx.session.content.data;
    return { subtitle: `Guess a number between ${minNumber} and ${maxNumber}` };
  },

  async start(ctx, { randomize }) {
    const order = [...ctx.session.players];
    if (randomize) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return { tokenOrder: order.map((p) => `guess_${p.id}`), firstPlayerId: order[0]?.id };
  },

  // Deliberately no `answered`: a guess stays secret until the reveal.
  async getAnswerHints() {
    return { nextTokenLabel: "number" };
  },

  async buildPlayProps(ctx) {
    const { title, data } = ctx.session.content;
    const { tokenOrder, currentTokenIndex } = ctx.session;
    return {
      title,
      min: data.minNumber,
      max: data.maxNumber,
      tokenOrder,
      initialCurrentTokenId: tokenOrder[currentTokenIndex] ?? tokenOrder[0],
      initialCurrentPlayerId: ctx.session.currentPlayerId ?? ctx.session.hostId,
      initialTokenIndex: currentTokenIndex,
    };
  },

  async buildResult(ctx) {
    const { title, data } = ctx.session.content;
    const rankings = (await ctx.answers())
      .map((a) => ({
        player: a.username ?? "Unknown",
        guess: parseInt(a.value, 10),
        distance: Math.abs(parseInt(a.value, 10) - data.secretNumber),
      }))
      .sort((a, b) => a.distance - b.distance);

    return { title, secretNumber: data.secretNumber, min: data.minNumber, max: data.maxNumber, rankings };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      handler: async (ctx) =>
        (await ctx.content.list({ limit: 20 })).map((game) => ({
          id: game.id,
          title: game.title,
          minNumber: game.data.minNumber,
          maxNumber: game.data.maxNumber,
          createdAt: game.createdAt,
        })),
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, input: z.infer<typeof CreateSchema>) => {
        const { min, max } = input;
        if (min >= max) throw new GameError(400, "min must be less than max");

        const game = await ctx.content.create({
          title: input.title ?? `Guess ${min}–${max}`,
          data: { minNumber: min, maxNumber: max, secretNumber: Math.floor(Math.random() * (max - min + 1)) + min },
        });
        return { id: game.id, title: game.title };
      },
    },
  },

  PlayComponent: NumberGameBoard,
  RevealComponent: NumberGameReveal,
  BrowsePage,
});
