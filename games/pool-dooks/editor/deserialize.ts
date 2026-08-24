import type { JSONContent } from "@tiptap/react";
import type { PoolDookToken } from "../schema";
import { customAlphabet } from "nanoid";

const generateId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

// Generic POS labels that should never be linked (each occurrence is a separate blank)
const GENERIC_TYPES = new Set([
  "noun", "plural noun", "verb", "verb -ing", "verb past tense",
  "adjective", "adverb", "exclamation", "name", "place", "number",
  "animal", "body part", "color", "occupation", "custom",
]);

interface ImportResult {
  bodyText: string;
  tokens: PoolDookToken[];
  bodyJson: JSONContent;
}

// Parse plain text with [label] or {label} placeholders.
// Same non-generic label appearing multiple times → same token ID (linked blank).
export function parsePlainText(text: string): ImportResult {
  const tokens: PoolDookToken[] = [];
  const occurrenceMap: Record<string, number> = {};
  const labelIdMap = new Map<string, string>();
  let position = 0;
  let bodyText = "";

  const paragraphNodes: JSONContent[] = [];

  for (const line of text.split("\n")) {
    const inlineNodes: JSONContent[] = [];
    const regex = /\[([^\]]+)\]|\{([^}]+)\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      const label = match[1] || match[2];
      const type = normalizeType(label);

      if (match.index > lastIndex) {
        const textContent = line.slice(lastIndex, match.index);
        inlineNodes.push({ type: "text", text: textContent });
        bodyText += textContent;
      }

      const isGeneric = GENERIC_TYPES.has(label.toLowerCase());
      const existingId = !isGeneric ? labelIdMap.get(label) : undefined;

      if (existingId) {
        bodyText += `{{${existingId}}}`;
        inlineNodes.push({
          type: "blank",
          attrs: { id: existingId, label, tokenType: type },
        });
      } else {
        const id = generateId();
        if (!isGeneric) labelIdMap.set(label, id);

        occurrenceMap[type] = (occurrenceMap[type] || 0) + 1;
        const token: PoolDookToken = {
          id,
          label,
          type,
          position,
          occurrence: occurrenceMap[type],
        };
        tokens.push(token);
        bodyText += `{{${id}}}`;
        position++;

        inlineNodes.push({
          type: "blank",
          attrs: { id, label, tokenType: type },
        });
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      const remaining = line.slice(lastIndex);
      inlineNodes.push({ type: "text", text: remaining });
      bodyText += remaining;
    }

    paragraphNodes.push({ type: "paragraph", content: inlineNodes });
    bodyText += "\n";
  }

  return {
    bodyText: bodyText.trim(),
    tokens,
    bodyJson: { type: "doc", content: paragraphNodes },
  };
}

export function parseJsonImport(json: unknown): ImportResult {
  const data = json as { body_text: string; tokens: PoolDookToken[] };
  return buildFromBodyText(data.body_text, data.tokens);
}

export function buildFromBodyText(
  bodyText: string,
  tokens: PoolDookToken[]
): ImportResult {
  const tokenMap = new Map(tokens.map((t) => [t.id, t]));
  const paragraphNodes: JSONContent[] = [];

  for (const line of bodyText.split("\n")) {
    const inlineNodes: JSONContent[] = [];
    const regex = /\{\{([^}]+)\}\}/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) {
        inlineNodes.push({ type: "text", text: line.slice(lastIndex, match.index) });
      }
      const token = tokenMap.get(match[1]);
      if (token) {
        inlineNodes.push({
          type: "blank",
          attrs: { id: token.id, label: token.label, tokenType: token.type },
        });
      }
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < line.length) {
      inlineNodes.push({ type: "text", text: line.slice(lastIndex) });
    }

    paragraphNodes.push({ type: "paragraph", content: inlineNodes });
  }

  return {
    bodyText,
    tokens,
    bodyJson: { type: "doc", content: paragraphNodes },
  };
}

function normalizeType(label: string): string {
  const l = label.toLowerCase();
  if (l.includes("plural")) return "plural noun";
  if (l.includes("-ing") || l.includes("ing form")) return "verb -ing";
  if (l.includes("past tense") || l.includes("past")) return "verb past tense";
  if (l.includes("noun")) return "noun";
  if (l.includes("verb")) return "verb";
  if (l.includes("adjective") || l.includes("adj")) return "adjective";
  if (l.includes("adverb")) return "adverb";
  if (l.includes("exclamation") || l.includes("interjection")) return "exclamation";
  if (l.includes("animal") || l.includes("creature")) return "animal";
  if (l.includes("body part") || l.includes("body")) return "body part";
  if (l.includes("color") || l.includes("colour")) return "color";
  if (l.includes("occupation") || l.includes("job") || l.includes("profession")) return "occupation";
  if (l.includes("name") || l.includes("person")) return "name";
  if (l.includes("place") || l.includes("location") || l.includes("city")) return "place";
  if (l.includes("number") || l.includes("num")) return "number";
  return "custom";
}
