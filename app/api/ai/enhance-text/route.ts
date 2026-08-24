import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildFromBodyText } from "@/lib/editor/deserialize";
import { z } from "zod";

const anthropic = new Anthropic({ maxRetries: 4 });

const Schema = z.object({ text: z.string().min(10).max(5000) });

const PROMPT = `You are helping create a Pool Dooks game. The user has pasted a story or passage. Your job is to pick the best words to replace with blanks — typically 8–15 words that make the story funny when swapped out.

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

The label should describe what kind of word to enter (e.g. "silly adjective", "action verb", "famous person's name").
The occurrence field counts how many times that type has appeared so far (first noun = 1, second noun = 2, etc.).`;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [
        {
          role: "user",
          content: `Here is the text to turn into a Pool Dook:\n\n${parsed.data.text}`,
        },
      ],
      system: PROMPT,
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
    console.error("[ai/enhance-text]", err);
    const message = err instanceof Error ? err.message : String(err);
    const isFilter = message.includes("content filtering") || message.includes("content_filter");
    return NextResponse.json(
      { error: isFilter ? "The text was blocked by content filters. Try rephrasing it." : message },
      { status: 500 }
    );
  }
}
