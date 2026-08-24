import type { JSONContent } from "@tiptap/react";
import type { PoolDookToken } from "../schema";

interface SerializeResult {
  bodyText: string;
  tokens: PoolDookToken[];
}

export function serializeEditorContent(doc: JSONContent): SerializeResult {
  const tokens: PoolDookToken[] = [];
  const seenIds = new Set<string>();
  const occurrenceMap: Record<string, number> = {};
  let position = 0;
  let bodyText = "";

  function processNode(node: JSONContent) {
    if (node.type === "blank") {
      const id = node.attrs?.id as string;
      const type = (node.attrs?.tokenType as string) || "custom";
      const label = (node.attrs?.label as string) || type;

      bodyText += `{{${id}}}`;

      if (!seenIds.has(id)) {
        seenIds.add(id);
        occurrenceMap[type] = (occurrenceMap[type] || 0) + 1;
        tokens.push({
          id,
          label,
          type,
          position,
          occurrence: occurrenceMap[type],
        });
        position++;
      }
    } else if (node.type === "text") {
      bodyText += node.text || "";
    } else if (node.type === "paragraph") {
      if (node.content) {
        node.content.forEach(processNode);
      }
      bodyText += "\n";
    } else if (node.content) {
      node.content.forEach(processNode);
    }
  }

  if (doc.content) {
    doc.content.forEach(processNode);
  }

  return { bodyText: bodyText.trim(), tokens };
}
