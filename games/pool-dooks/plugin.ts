import type { z } from "zod";
import { defineGame, GameError, type ContentRecord, type SessionContext } from "@/lib/game-sdk";
import {
  AiStorySchema,
  CreateSchema,
  EnhanceSchema,
  GenerateSchema,
  IdSchema,
  ImportSchema,
  ListSchema,
  ScanSchema,
  UpdateSchema,
  type PoolDookContent,
} from "./schema";
import { resolveTokenOrder } from "./utils";
import { serializeEditorContent } from "./editor/serialize";
import { parsePlainText, parseJsonImport, buildFromBodyText } from "./editor/deserialize";
import { EXTRA_WEIRD_SYSTEM_PROMPT, NORMAL_SYSTEM_PROMPT, buildUserPrompt } from "./ai/prompts";
import { GameBoard } from "./components/GameBoard";
import { RevealDisplay } from "./components/RevealDisplay";
import BrowsePage from "./pages/BrowsePage";
import CreatePage from "./pages/CreatePage";
import LibraryPage from "./pages/LibraryPage";

type Ctx = SessionContext<PoolDookContent, never>;
type SerializableDoc = Parameters<typeof serializeEditorContent>[0];

// The AI actions below go through core's ctx.ai, which meters them: see the
// `ai` declaration and docs/creating-a-game.md. Without a key on the server
// core reports AI unavailable and the create page hides them.

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

type AiStory = z.infer<typeof AiStorySchema>;

/** Turns the model's story into editor content. */
function toDraft(story: AiStory) {
  const { bodyJson } = buildFromBodyText(story.body_text, story.tokens);
  return { title: story.title, bodyText: story.body_text, tokens: story.tokens, bodyJson };
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

  // Each AI feature, metered by core. The model must answer with a story.
  ai: {
    generate: { tier: "fast", maxInputChars: 600, maxOutputTokens: 2048, output: AiStorySchema, perUserPerDay: 10 },
    enhance: { tier: "smart", maxInputChars: 5100, maxOutputTokens: 2048, output: AiStorySchema, perUserPerDay: 10 },
    scan: { tier: "smart", maxInputChars: 100, maxOutputTokens: 4096, images: true, output: AiStorySchema, perUserPerDay: 5 },
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
      handler: async (ctx, input: z.infer<typeof GenerateSchema>) =>
        toDraft(
          await ctx.ai.run<AiStory>("generate", {
            system: input.extraWeird ? EXTRA_WEIRD_SYSTEM_PROMPT : NORMAL_SYSTEM_PROMPT,
            input: buildUserPrompt(input.theme, input.title),
          })
        ),
    },

    enhance: {
      auth: "account",
      input: EnhanceSchema,
      handler: async (ctx, { text }: z.infer<typeof EnhanceSchema>) =>
        toDraft(
          await ctx.ai.run<AiStory>("enhance", {
            system: ENHANCE_PROMPT,
            input: `Here is the text to turn into a Mad Libs-style story:\n\n${text}`,
          })
        ),
    },

    /** Reads a photographed page. The browser sends the image as base64. */
    scan: {
      auth: "account",
      input: ScanSchema,
      handler: async (ctx, { mediaType, data }: z.infer<typeof ScanSchema>) =>
        toDraft(
          await ctx.ai.run<AiStory>("scan", {
            system: SCAN_PROMPT,
            input: [
              { type: "image", mediaType, data },
              { type: "text", text: "Here is the page." },
            ],
          })
        ),
    },
  },

  PlayComponent: GameBoard,
  RevealComponent: RevealDisplay,
  BrowsePage,
  CreatePage,
  LibraryPage,
});
