import Anthropic from "@anthropic-ai/sdk";
import {
  NORMAL_SYSTEM_PROMPT,
  EXTRA_WEIRD_SYSTEM_PROMPT,
  buildUserPrompt,
} from "./prompts";
import type { PoolDookToken } from "@/lib/db/schema";
import { buildFromBodyText } from "@/lib/editor/deserialize";
import type { JSONContent } from "@tiptap/react";

const anthropic = new Anthropic({ maxRetries: 4 });

export interface GenerateResult {
  title: string;
  bodyText: string;
  tokens: PoolDookToken[];
  bodyJson: JSONContent;
}

export async function generatePoolDook(
  theme: string,
  extraWeird: boolean,
  title?: string
): Promise<GenerateResult> {
  const systemPrompt = extraWeird ? EXTRA_WEIRD_SYSTEM_PROMPT : NORMAL_SYSTEM_PROMPT;
  const userPrompt = buildUserPrompt(theme, title);

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== "text") throw new Error("Unexpected response type");

  const jsonMatch = content.text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("No JSON found in response");

  const parsed = JSON.parse(jsonMatch[0]) as {
    title: string;
    body_text: string;
    tokens: PoolDookToken[];
  };

  const { bodyJson } = buildFromBodyText(parsed.body_text, parsed.tokens);

  return {
    title: parsed.title,
    bodyText: parsed.body_text,
    tokens: parsed.tokens,
    bodyJson,
  };
}
