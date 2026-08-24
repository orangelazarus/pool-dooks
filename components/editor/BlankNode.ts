import { Node, mergeAttributes } from "@tiptap/core";
import { customAlphabet } from "nanoid";

const generateId = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 8);

export const TOKEN_TYPES = [
  "noun",
  "plural noun",
  "verb",
  "verb -ing",
  "verb past tense",
  "adjective",
  "adverb",
  "exclamation",
  "name",
  "place",
  "number",
  "animal",
  "body part",
  "color",
  "occupation",
  "custom",
] as const;

export type TokenType = (typeof TOKEN_TYPES)[number];

export const TOKEN_COLORS: Record<string, string> = {
  noun: "bg-blue-100 text-blue-800 border-blue-200",
  "plural noun": "bg-blue-200 text-blue-900 border-blue-300",
  verb: "bg-green-100 text-green-800 border-green-200",
  "verb -ing": "bg-green-200 text-green-900 border-green-300",
  "verb past tense": "bg-emerald-100 text-emerald-800 border-emerald-200",
  adjective: "bg-purple-100 text-purple-800 border-purple-200",
  adverb: "bg-orange-100 text-orange-800 border-orange-200",
  exclamation: "bg-red-100 text-red-800 border-red-200",
  name: "bg-pink-100 text-pink-800 border-pink-200",
  place: "bg-yellow-100 text-yellow-800 border-yellow-200",
  number: "bg-teal-100 text-teal-800 border-teal-200",
  animal: "bg-lime-100 text-lime-800 border-lime-200",
  "body part": "bg-amber-100 text-amber-800 border-amber-200",
  color: "bg-violet-100 text-violet-800 border-violet-200",
  occupation: "bg-cyan-100 text-cyan-800 border-cyan-200",
  custom: "bg-gray-100 text-gray-800 border-gray-200",
};

export const BlankNode = Node.create({
  name: "blank",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-id"),
        renderHTML: (attrs) => ({ "data-id": attrs.id }),
      },
      label: {
        default: "noun",
        parseHTML: (el) => el.getAttribute("data-label"),
        renderHTML: (attrs) => ({ "data-label": attrs.label }),
      },
      tokenType: {
        default: "noun",
        parseHTML: (el) => el.getAttribute("data-token-type"),
        renderHTML: (attrs) => ({ "data-token-type": attrs.tokenType }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-blank]" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-blank": "",
        class: "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border mx-0.5 cursor-default select-none",
      }),
      `[${HTMLAttributes["data-label"]}]`,
    ];
  },

  addCommands() {
    return {
      insertBlank:
        (attrs: { label: string; tokenType: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: "blank",
            attrs: {
              id: generateId(),
              label: attrs.label,
              tokenType: attrs.tokenType,
            },
          });
        },
      insertLinkedBlank:
        (attrs: { id: string; label: string; tokenType: string }) =>
        ({ commands }) => {
          return commands.insertContent({
            type: "blank",
            attrs: { id: attrs.id, label: attrs.label, tokenType: attrs.tokenType },
          });
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    blank: {
      insertBlank: (attrs: { label: string; tokenType: string }) => ReturnType;
      insertLinkedBlank: (attrs: { id: string; label: string; tokenType: string }) => ReturnType;
    };
  }
}
