import type { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { defineGame, GameError, type ContentRecord, type SessionContext } from "@/lib/game-sdk";
import {
  CreateSchema,
  EnhanceSchema,
  GenerateSchema,
  IdSchema,
  ImportSchema,
  ListSchema,
  ScanSchema,
  UpdateSchema,
  type PoolDookContent,
  type PoolDookToken,
} from "./schema";
import { resolveTokenOrder } from "./utils";
import { serializeEditorContent } from "./editor/serialize";
import { parsePlainText, parseJsonImport, buildFromBodyText } from "./editor/deserialize";
import { generatePoolDook } from "./ai/generate";
import { GameBoard } from "./components/GameBoard";
import { RevealDisplay } from "./components/RevealDisplay";
import BrowsePage from "./pages/BrowsePage";
import CreatePage from "./pages/CreatePage";
import LibraryPage from "./pages/LibraryPage";

type Ctx = SessionContext<PoolDookContent, never>;
type SerializableDoc = Parameters<typeof serializeEditorContent>[0];

// The AI actions below are declared `auth: "account"`: they call a paid API
// and aren't rate limited, and a guest account costs nothing to make.
const anthropic = new Anthropic({ maxRetries: 4 });

const ENHANCE_PROMPT = `You are helping create a Mad Libs-style fill-in-the-blank game. The user has pasted a story or passage. Your job is to pick the best words to replace with blanks — typically 8–15 words that make the story funny when swapped out.

Choose interesting nouns, verbs, adjectives, adverbs, names, and places. Avoid replacing articles, prepositions, or words that would make the sentence grammatically broken.

Return ONLY valid JSON, no other text:
{
  "title": "A short title for this story (3-6 words)",
  "body_text": "The full text with {{t1}}, {{t2}}, etc. replacing the chosen words",
  "tokens": [
    {"id": "t1", "label": "noun", "type": "noun", "position": 0, "occurrence": 1}
  ]
}

Token types: noun, plural noun, verb, verb -ing, verb past tense, adjective, adverb, exclamation, name, place, number, animal, body part, color, occupation, custom

The label is ONLY the part of speech — no descriptors.
The occurrence field counts how many times that type has appeared so far (first noun = 1, second noun = 2, etc.).`;

const SCAN_PROMPT = `You are scanning a physical Mad Libs page. Extract the title and full story text, replacing each blank line with a {{token_id}} placeholder.

Return ONLY valid JSON in this exact format, no other text:
{
  "title": "Story title from the page",
  "body_text": "Full story text with {{t1}}, {{t2}}, etc. placeholders where the blanks are",
  "tokens": [
    {"id": "t1", "label": "adjective", "type": "adjective", "position": 0, "occurrence": 1},
    {"id": "t2", "label": "plural noun", "type": "plural noun", "position": 1, "occurrence": 1}
  ]
}

Rules:
- Each blank line (with a label printed beneath it) becomes one token
- Token IDs must be t1, t2, t3... in order of appearance in the text
- The label field is the text printed under the blank — lowercase it
- The type field must be one of: noun, plural noun, verb, verb -ing, verb past tense, adjective, adverb, exclamation, name, place, number, animal, body part, color, occupation, custom
- The occurrence field counts how many times that type has appeared so far
- Preserve all story text exactly, only replacing blank lines with {{tn}} placeholders
- If the same blank is referenced multiple times (e.g. "SAME ADJECTIVE"), reuse the same token id`;

/** What the browse and library cards need — never the story text itself. */
function toCard(row: ContentRecord<PoolDookContent>) {
  return {
    id: row.id,
    title: row.title,
    theme: row.data.theme,
    tokens: row.data.tokens,
    isPublic: row.isPublic,
    aiGenerated: row.data.aiGenerated,
    extraWeird: row.data.extraWeird,
    createdAt: row.createdAt,
    authorId: row.authorId,
    author: { username: row.authorName },
  };
}

/** Pulls the JSON object out of a model reply and turns it into editor content. */
function storyFromModelReply(message: Anthropic.Message) {
  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");
  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");
  const result = JSON.parse(jsonMatch[0]) as { title: string; body_text: string; tokens: PoolDookToken[] };
  const { bodyJson } = buildFromBodyText(result.body_text, result.tokens);
  return { title: result.title, bodyText: result.body_text, tokens: result.tokens, bodyJson };
}

/** Runs an AI call, turning a failure into a message worth showing the author. */
async function withAiErrors<T>(blockedMessage: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isFilter = message.includes("content filtering") || message.includes("content_filter");
    throw new GameError(500, isFilter ? blockedMessage : message);
  }
}

const tokensOf = (ctx: Ctx) => ctx.session.content.data.tokens ?? [];

// Runs on the shared turn engine: one token per blank, answered through core's
// answer route. No session state of its own.
export const plugin = defineGame<PoolDookContent, never>({
  gameType: "pool_dooks",
  displayName: "Pool Dooks",
  description: "Fill in the blanks together, then read the hilarious result",
  minPlayers: 1,
  maxPlayers: 16,
  supportsRandomize: true,

  async getLobbyMeta(ctx) {
    const count = tokensOf(ctx).length;
    return { subtitle: `${count} blank${count !== 1 ? "s" : ""} to fill` };
  },

  async start(ctx, { randomize }) {
    return { tokenOrder: resolveTokenOrder(tokensOf(ctx), randomize) };
  },

  async getAnswerHints(ctx, answer) {
    const tokens = tokensOf(ctx);
    const next = tokens.find((t) => t.id === answer.nextTokenId);
    const filled = tokens.find((t) => t.id === answer.tokenId);
    return {
      nextTokenLabel: next?.label,
      // Players never see the story while filling blanks, so the words
      // themselves are safe (and fun) to share as they come in.
      answered: filled ? { label: filled.label, type: filled.type } : undefined,
    };
  },

  async buildPlayProps(ctx) {
    const { tokenOrder, currentTokenIndex } = ctx.session;
    // Answers given so far, so a reload or a late observer sees them too.
    const initialAnswers = Object.fromEntries(
      (await ctx.answers()).map((a) => [a.tokenId, { value: a.value, username: a.username ?? "Unknown" }])
    );
    return {
      tokens: tokensOf(ctx),
      tokenOrder,
      initialAnswers,
      initialCurrentTokenId: tokenOrder[currentTokenIndex] ?? tokenOrder[0],
      initialCurrentPlayerId: ctx.session.currentPlayerId ?? ctx.session.hostId,
      initialTokenIndex: currentTokenIndex,
    };
  },

  async buildResult(ctx) {
    const { title, data } = ctx.session.content;
    const given = await ctx.answers();

    let resultText = data.bodyText;
    for (const answer of given) {
      resultText = resultText.replace(new RegExp(`\\{\\{${answer.tokenId}\\}\\}`, "g"), `**${answer.value}**`);
    }

    resultText = resultText.replace(
      /\b(a\/an)\s+\*\*([a-zA-Z])/gi,
      (_, article, firstLetter) => {
        const isVowel = /[aeiou]/i.test(firstLetter);
        const corrected =
          article[0] === "A"
            ? isVowel ? "An" : "A"
            : isVowel ? "an" : "a";
        return `${corrected} **${firstLetter}`;
      }
    );

    const tokens = tokensOf(ctx);
    const answersWithMeta = ctx.session.tokenOrder.map((tokenId) => {
      const token = tokens.find((t) => t.id === tokenId);
      const answer = given.find((a) => a.tokenId === tokenId);
      return {
        tokenId,
        label: token?.label ?? tokenId,
        type: token?.type ?? "custom",
        value: answer?.value ?? "",
        player: answer?.username ?? "Unknown",
      };
    });

    return { title, theme: data.theme, resultText, answersWithMeta, completedAt: ctx.session.completedAt };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      input: ListSchema,
      handler: async (ctx, input: z.infer<typeof ListSchema>) =>
        (
          await ctx.content.list({
            mine: input.mine,
            search: input.search,
            where: input.theme ? { theme: input.theme } : undefined,
          })
        ).map(toCard),
    },

    /** One story with its editor content — for the edit page. */
    get: {
      method: "GET",
      auth: "user",
      input: IdSchema,
      handler: async (ctx, { id }: z.infer<typeof IdSchema>) => {
        const row = await ctx.content.get(id);
        if (!row) throw new GameError(404, "Not found");
        return { id: row.id, title: row.title, theme: row.data.theme, isPublic: row.isPublic, bodyJson: row.data.bodyJson };
      },
    },

    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, input: z.infer<typeof CreateSchema>) => {
        const { bodyText, tokens } = serializeEditorContent(input.bodyJson as SerializableDoc);
        const row = await ctx.content.create({
          title: input.title,
          isPublic: input.isPublic,
          data: {
            theme: input.theme,
            bodyJson: input.bodyJson,
            bodyText,
            tokens,
            aiGenerated: input.aiGenerated,
            extraWeird: input.extraWeird,
            importSource: input.importSource ?? null,
          },
        });
        return toCard(row);
      },
    },

    update: {
      method: "PUT",
      auth: "user",
      input: UpdateSchema,
      handler: async (ctx, input: z.infer<typeof UpdateSchema>) => {
        const existing = await ctx.content.get(input.id);
        if (!existing) throw new GameError(404, "Not found");
        const { bodyText, tokens } = serializeEditorContent(input.bodyJson as SerializableDoc);
        // Core refuses this unless the viewer is the author.
        const row = await ctx.content.update(input.id, {
          title: input.title,
          isPublic: input.isPublic,
          data: { ...existing.data, theme: input.theme, bodyJson: input.bodyJson, bodyText, tokens },
        });
        return toCard(row);
      },
    },

    remove: {
      method: "DELETE",
      auth: "user",
      input: IdSchema,
      handler: async (ctx, { id }: z.infer<typeof IdSchema>) => ctx.content.remove(id),
    },

    /** Turns pasted text or an exported JSON file into editor content. Nothing is saved. */
    import: {
      auth: "user",
      input: ImportSchema,
      handler: async (_ctx, input: z.infer<typeof ImportSchema>) => {
        if (input.json === undefined && !input.text) throw new GameError(400, "Provide text or json field");
        try {
          return input.json !== undefined ? parseJsonImport(input.json) : parsePlainText(input.text!);
        } catch {
          throw new GameError(400, "That doesn't look like a Pool Dooks export");
        }
      },
    },

    generate: {
      auth: "account",
      input: GenerateSchema,
      handler: async (_ctx, input: z.infer<typeof GenerateSchema>) =>
        withAiErrors("The request was blocked by content filters. Try a different theme or title.", () =>
          generatePoolDook(input.theme, input.extraWeird, input.title)
        ),
    },

    enhance: {
      auth: "account",
      input: EnhanceSchema,
      handler: async (_ctx, { text }: z.infer<typeof EnhanceSchema>) =>
        withAiErrors("The text was blocked by content filters. Try rephrasing it.", async () =>
          storyFromModelReply(
            await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 2048,
              messages: [{ role: "user", content: `Here is the text to turn into a Mad Libs-style story:\n\n${text}` }],
              system: ENHANCE_PROMPT,
            })
          )
        ),
    },

    /** Reads a photographed page. The browser sends the image as base64. */
    scan: {
      auth: "account",
      input: ScanSchema,
      handler: async (_ctx, { mediaType, data }: z.infer<typeof ScanSchema>) =>
        withAiErrors("The image was blocked by content filters. Try a different image.", async () =>
          storyFromModelReply(
            await anthropic.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 4096,
              messages: [
                {
                  role: "user",
                  content: [
                    { type: "image", source: { type: "base64", media_type: mediaType, data } },
                    { type: "text", text: SCAN_PROMPT },
                  ],
                },
              ],
            })
          )
        ),
    },
  },

  PlayComponent: GameBoard,
  RevealComponent: RevealDisplay,
  BrowsePage,
  CreatePage,
  LibraryPage,
});
