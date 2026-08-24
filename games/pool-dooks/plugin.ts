import { NextRequest, NextResponse } from "next/server";
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, desc, and, ilike } from "drizzle-orm";
import { profiles } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { poolDooks, type PoolDookToken } from "./schema";
import { resolveTokenOrder } from "./utils";
import { serializeEditorContent } from "./editor/serialize";
import { parsePlainText, parseJsonImport, buildFromBodyText } from "./editor/deserialize";
import { generatePoolDook } from "./ai/generate";
import { buildUserPrompt } from "./ai/prompts";
import { GameBoard } from "./components/GameBoard";
import { RevealDisplay } from "./components/RevealDisplay";
import BrowsePage from "./pages/BrowsePage";
import CreatePage from "./pages/CreatePage";
import LibraryPage from "./pages/LibraryPage";

function contentId(session: Session): string {
  const id = session.gameContentId ?? session.poolDookId;
  if (!id) throw new Error("Session has no game content ID");
  return id;
}

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  theme: z.string().min(1),
  bodyJson: z.record(z.string(), z.unknown()),
  isPublic: z.boolean().optional().default(true),
  aiGenerated: z.boolean().optional().default(false),
  extraWeird: z.boolean().optional().default(false),
  importSource: z.string().optional(),
});

const GenerateSchema = z.object({
  theme: z.string().min(1),
  extraWeird: z.boolean().optional().default(false),
  title: z.string().optional(),
});

const anthropic = new Anthropic({ maxRetries: 4 });

const ENHANCE_PROMPT = `You are helping create a Pool Dooks game. The user has pasted a story or passage. Your job is to pick the best words to replace with blanks — typically 8–15 words that make the story funny when swapped out.

Choose interesting nouns, verbs, adjectives, adverbs, names, and places. Avoid replacing articles, prepositions, or words that would make the sentence grammatically broken.

Return ONLY valid JSON, no other text:
{
  "title": "A short title for this pool dook (3-6 words)",
  "body_text": "The full text with {{t1}}, {{t2}}, etc. replacing the chosen words",
  "tokens": [
    {"id": "t1", "label": "noun", "type": "noun", "position": 0, "occurrence": 1}
  ]
}

Token types: noun, plural noun, verb, verb -ing, verb past tense, adjective, adverb, exclamation, name, place, number, animal, body part, color, occupation, custom

The label is ONLY the part of speech — no descriptors.
The occurrence field counts how many times that type has appeared so far (first noun = 1, second noun = 2, etc.).`;

const SCAN_PROMPT = `You are scanning a physical Pool Dooks page. Extract the title and full story text, replacing each blank line with a {{token_id}} placeholder.

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

export const plugin: GamePlugin = {
  gameType: "pool_dooks",
  displayName: "Pool Dooks",
  description: "Fill in the blanks together, then read the hilarious result",
  browsePath: "/games/pool_dooks",
  minPlayers: 1,
  maxPlayers: 16,
  supportsRandomize: true,

  async getContentMeta(gameContentId: string) {
    const [poolDook] = await db
      .select({ title: poolDooks.title })
      .from(poolDooks)
      .where(eq(poolDooks.id, gameContentId));
    if (!poolDook) throw new Error("Pool Dook not found");
    return { title: poolDook.title };
  },

  async start(session: Session, _players: SessionPlayerInfo[], randomize: boolean) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");
    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = resolveTokenOrder(tokens, randomize);
    return { tokenOrder };
  },

  async getAnswerHints(ctx: AnswerContext) {
    if (!ctx.nextTokenId) return {};
    const [poolDook] = await db
      .select({ tokens: poolDooks.tokens })
      .from(poolDooks)
      .where(eq(poolDooks.id, contentId(ctx.session)));
    const tokens = (poolDook?.tokens ?? []) as PoolDookToken[];
    const token = tokens.find((t) => t.id === ctx.nextTokenId);
    return { nextTokenLabel: token?.label };
  },

  async buildResult(session: Session, sessionAnswers: Answer[]) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");

    let resultText = poolDook.bodyText;
    for (const answer of sessionAnswers) {
      resultText = resultText.replace(
        new RegExp(`\\{\\{${answer.tokenId}\\}\\}`, "g"),
        `**${answer.value}**`
      );
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

    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const answersWithMeta = tokenOrder.map((tokenId) => {
      const token = tokens.find((t) => t.id === tokenId);
      const answer = sessionAnswers.find((a) => a.tokenId === tokenId);
      return {
        tokenId,
        label: token?.label ?? tokenId,
        type: token?.type ?? "custom",
        value: answer?.value ?? "",
        player: (answer as (Answer & { username?: string | null }) | undefined)?.username ?? "Unknown",
      };
    });

    return {
      title: poolDook.title,
      theme: poolDook.theme,
      resultText,
      answersWithMeta,
      completedAt: session.completedAt,
    };
  },

  async buildPlayProps(session: Session, _players: SessionPlayerInfo[]) {
    const [poolDook] = await db.select().from(poolDooks).where(eq(poolDooks.id, contentId(session)));
    if (!poolDook) throw new Error("Pool Dook not found");
    const tokens = (poolDook.tokens ?? []) as PoolDookToken[];
    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const currentTokenId = tokenOrder[session.currentTokenIndex ?? 0] ?? tokenOrder[0];
    return {
      tokens,
      tokenOrder,
      initialCurrentTokenId: currentTokenId,
      initialCurrentPlayerId: session.currentPlayerId ?? session.hostId,
      initialTokenIndex: session.currentTokenIndex ?? 0,
    };
  },

  async getLobbyMeta(session: Session) {
    const [poolDook] = await db
      .select({ tokens: poolDooks.tokens })
      .from(poolDooks)
      .where(eq(poolDooks.id, contentId(session)));
    const count = ((poolDook?.tokens ?? []) as PoolDookToken[]).length;
    return { subtitle: `${count} blank${count !== 1 ? "s" : ""} to fill` };
  },

  async handleRequest(req: NextRequest, path: string[]) {
    const method = req.method;
    const [seg0, seg1, seg2] = path;

    // POST /import
    if (method === "POST" && seg0 === "import") {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("multipart/form-data")) {
        const form = await req.formData();
        const file = form.get("file") as File | null;
        if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });
        const text = await file.text();
        try {
          const json = JSON.parse(text);
          return NextResponse.json(parseJsonImport(json));
        } catch {
          return NextResponse.json(parsePlainText(text));
        }
      } else {
        const body = await req.json();
        if (body.text) return NextResponse.json(parsePlainText(body.text));
        if (body.json) return NextResponse.json(parseJsonImport(body.json));
        return NextResponse.json({ error: "Provide text or json field" }, { status: 400 });
      }
    }

    // AI routes: /ai/generate, /ai/enhance-text, /ai/scan-image
    if (seg0 === "ai") {
      if (method === "POST" && seg1 === "generate") {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

        const body = await req.json();
        const parsed = GenerateSchema.safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

        try {
          const result = await generatePoolDook(parsed.data.theme, parsed.data.extraWeird, parsed.data.title);
          return NextResponse.json(result);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }

      if (method === "POST" && seg1 === "enhance-text") {
        const body = await req.json();
        const parsed = z.object({ text: z.string().min(10).max(5000) }).safeParse(body);
        if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

        try {
          const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 2048,
            messages: [{ role: "user", content: `Here is the text to turn into a Pool Dook:\n\n${parsed.data.text}` }],
            system: ENHANCE_PROMPT,
          });
          const content = message.content[0];
          if (content.type !== "text") throw new Error("Unexpected response type");
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("No JSON in response");
          const result = JSON.parse(jsonMatch[0]) as {
            title: string;
            body_text: string;
            tokens: Array<{ id: string; label: string; type: string; position: number; occurrence: number }>;
          };
          const { bodyJson } = buildFromBodyText(result.body_text, result.tokens);
          return NextResponse.json({ title: result.title, bodyText: result.body_text, tokens: result.tokens, bodyJson });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isFilter = message.includes("content filtering") || message.includes("content_filter");
          return NextResponse.json(
            { error: isFilter ? "The text was blocked by content filters. Try rephrasing it." : message },
            { status: 500 }
          );
        }
      }

      if (method === "POST" && seg1 === "scan-image") {
        try {
          const form = await req.formData();
          const file = form.get("image") as File | null;
          if (!file) return NextResponse.json({ error: "No image provided" }, { status: 400 });

          const allowedTypes = ["image/jpeg", "image/jpg", "image/png", "image/gif", "image/webp"];
          if (!allowedTypes.includes(file.type)) {
            return NextResponse.json({ error: "Unsupported image type. Use JPG, PNG, GIF, or WebP." }, { status: 400 });
          }

          const bytes = await file.arrayBuffer();
          const base64 = Buffer.from(bytes).toString("base64");
          const mediaType = file.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";

          const message = await anthropic.messages.create({
            model: "claude-sonnet-4-6",
            max_tokens: 4096,
            messages: [{
              role: "user",
              content: [
                { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } },
                { type: "text", text: SCAN_PROMPT },
              ],
            }],
          });

          const content = message.content[0];
          if (content.type !== "text") throw new Error("Unexpected response type");
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) throw new Error("No JSON found in response");
          const parsed = JSON.parse(jsonMatch[0]) as {
            title: string;
            body_text: string;
            tokens: Array<{ id: string; label: string; type: string; position: number; occurrence: number }>;
          };
          const { bodyJson } = buildFromBodyText(parsed.body_text, parsed.tokens);
          return NextResponse.json({ title: parsed.title, bodyText: parsed.body_text, tokens: parsed.tokens, bodyJson });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          const isFilter = message.includes("content filtering") || message.includes("content_filter");
          return NextResponse.json(
            { error: isFilter ? "The image was blocked by content filters. Try a different image." : message },
            { status: 500 }
          );
        }
      }
    }

    // CRUD routes
    // GET / (list)
    if (method === "GET" && !seg0) {
      const { searchParams } = new URL(req.url);
      const theme = searchParams.get("theme");
      const search = searchParams.get("search");
      const mine = searchParams.get("mine") === "true";

      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      const conditions = [];
      if (theme) conditions.push(eq(poolDooks.theme, theme));
      if (search) conditions.push(ilike(poolDooks.title, `%${search}%`));
      if (mine && user) conditions.push(eq(poolDooks.authorId, user.id));
      else conditions.push(eq(poolDooks.isPublic, true));

      const rows = await db
        .select({
          id: poolDooks.id,
          title: poolDooks.title,
          theme: poolDooks.theme,
          tokens: poolDooks.tokens,
          isPublic: poolDooks.isPublic,
          aiGenerated: poolDooks.aiGenerated,
          extraWeird: poolDooks.extraWeird,
          createdAt: poolDooks.createdAt,
          authorId: poolDooks.authorId,
          author: { username: profiles.username, avatarUrl: profiles.avatarUrl },
        })
        .from(poolDooks)
        .leftJoin(profiles, eq(poolDooks.authorId, profiles.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(poolDooks.createdAt))
        .limit(50);

      return NextResponse.json(rows);
    }

    // POST / (create)
    if (method === "POST" && !seg0) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const body = await req.json();
      const parsed = CreateSchema.safeParse(body);
      if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

      const { title, theme, bodyJson, isPublic, aiGenerated, extraWeird, importSource } = parsed.data;
      const { bodyText, tokens } = serializeEditorContent(bodyJson as Parameters<typeof serializeEditorContent>[0]);

      const [row] = await db
        .insert(poolDooks)
        .values({ authorId: user.id, title, theme, bodyJson, bodyText, tokens, isPublic, aiGenerated, extraWeird, importSource })
        .returning();

      return NextResponse.json(row, { status: 201 });
    }

    // GET /[id]
    if (method === "GET" && seg0 && !seg1) {
      const [row] = await db.select().from(poolDooks).where(eq(poolDooks.id, seg0));
      if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
      return NextResponse.json(row);
    }

    // PUT /[id]
    if (method === "PUT" && seg0 && !seg1) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const [existing] = await db.select().from(poolDooks).where(eq(poolDooks.id, seg0));
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (existing.authorId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      const body = await req.json();
      const { bodyText, tokens } = serializeEditorContent(body.bodyJson);
      const [updated] = await db
        .update(poolDooks)
        .set({ ...body, bodyText, tokens, updatedAt: new Date() })
        .where(eq(poolDooks.id, seg0))
        .returning();

      return NextResponse.json(updated);
    }

    // DELETE /[id]
    if (method === "DELETE" && seg0 && !seg1) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const [existing] = await db.select().from(poolDooks).where(eq(poolDooks.id, seg0));
      if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (existing.authorId !== user.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

      await db.delete(poolDooks).where(eq(poolDooks.id, seg0));
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },

  PlayComponent: GameBoard,
  RevealComponent: RevealDisplay,
  BrowsePage,
  CreatePage,
  LibraryPage,
};
