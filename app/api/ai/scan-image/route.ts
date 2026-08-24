import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildFromBodyText } from "@/lib/editor/deserialize";

const anthropic = new Anthropic({ maxRetries: 4 });

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
- The label field is the text printed under the blank (e.g. "ADJECTIVE", "PART OF THE BODY", "TYPE OF FOOD") — lowercase it
- The type field must be one of: noun, plural noun, verb, verb -ing, verb past tense, adjective, adverb, exclamation, name, place, number, animal, body part, color, occupation, custom
- Map "PART OF THE BODY" → type "body part", "TYPE OF FOOD" → type "occupation" (use "custom" if no good match)
- The occurrence field counts how many times that type has appeared so far (first noun = 1, second noun = 2, etc.)
- Preserve all story text exactly, only replacing blank lines with {{tn}} placeholders
- If the same blank is referenced multiple times (e.g. "SAME ADJECTIVE"), reuse the same token id`;

export async function POST(req: NextRequest) {
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
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: base64 },
            },
            { type: "text", text: SCAN_PROMPT },
          ],
        },
      ],
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

    return NextResponse.json({
      title: parsed.title,
      bodyText: parsed.body_text,
      tokens: parsed.tokens,
      bodyJson,
    });
  } catch (err) {
    console.error("[ai/scan-image]", err);
    const message = err instanceof Error ? err.message : String(err);
    const isFilter = message.includes("content filtering") || message.includes("content_filter");
    return NextResponse.json(
      { error: isFilter ? "The image was blocked by content filters. Try a different image." : message },
      { status: 500 }
    );
  }
}
