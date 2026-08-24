"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { BlankNode, TOKEN_COLORS } from "./BlankNode";
import { EditorToolbar } from "./EditorToolbar";
import type { JSONContent } from "@tiptap/react";
import { useEffect } from "react";

interface PoolDookEditorProps {
  content?: JSONContent;
  onChange?: (content: JSONContent) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export function PoolDookEditor({
  content,
  onChange,
  placeholder = "Start writing your pool dook story here... Click 'Insert Blank' to add fill-in-the-blank spots.",
  readOnly = false,
}: PoolDookEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder }),
      BlankNode,
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getJSON());
    },
    editorProps: {
      attributes: {
        class:
          "prose prose-sm max-w-none focus:outline-none min-h-[200px] p-4 leading-relaxed",
      },
    },
    immediatelyRender: false,
  });

  useEffect(() => {
    if (editor && content && !editor.isFocused) {
      editor.commands.setContent(content);
    }
  }, [editor, content]);

  return (
    <div className="border rounded-lg overflow-hidden bg-background">
      {!readOnly && <EditorToolbar editor={editor} />}
      <EditorContent editor={editor} />
      <style jsx global>{`
        .tiptap span[data-blank] {
          display: inline-flex;
          align-items: center;
          padding: 1px 8px;
          border-radius: 9999px;
          font-size: 0.75rem;
          font-weight: 500;
          border: 1px solid;
          margin: 0 2px;
          cursor: default;
          user-select: none;
        }
        ${Object.entries(TOKEN_COLORS)
          .map(
            ([type, classes]) =>
              `.tiptap span[data-token-type="${type}"] { ${classToCss(classes)} }`
          )
          .join("\n")}
        .tiptap p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          color: #9ca3af;
          pointer-events: none;
          height: 0;
          float: left;
        }
      `}</style>
    </div>
  );
}

function classToCss(classes: string): string {
  const map: Record<string, string> = {
    "bg-blue-100": "background-color: #dbeafe",
    "text-blue-800": "color: #1e40af",
    "border-blue-200": "border-color: #bfdbfe",
    "bg-green-100": "background-color: #dcfce7",
    "text-green-800": "color: #166534",
    "border-green-200": "border-color: #bbf7d0",
    "bg-purple-100": "background-color: #f3e8ff",
    "text-purple-800": "color: #6b21a8",
    "border-purple-200": "border-color: #e9d5ff",
    "bg-orange-100": "background-color: #ffedd5",
    "text-orange-800": "color: #9a3412",
    "border-orange-200": "border-color: #fed7aa",
    "bg-pink-100": "background-color: #fce7f3",
    "text-pink-800": "color: #9d174d",
    "border-pink-200": "border-color: #fbcfe8",
    "bg-yellow-100": "background-color: #fef9c3",
    "text-yellow-800": "color: #854d0e",
    "border-yellow-200": "border-color: #fef08a",
    "bg-blue-200": "background-color: #bfdbfe",
    "text-blue-900": "color: #1e3a8a",
    "border-blue-300": "border-color: #93c5fd",
    "bg-green-200": "background-color: #bbf7d0",
    "text-green-900": "color: #14532d",
    "border-green-300": "border-color: #86efac",
    "bg-emerald-100": "background-color: #d1fae5",
    "text-emerald-800": "color: #065f46",
    "border-emerald-200": "border-color: #a7f3d0",
    "bg-red-100": "background-color: #fee2e2",
    "text-red-800": "color: #991b1b",
    "border-red-200": "border-color: #fecaca",
    "bg-teal-100": "background-color: #ccfbf1",
    "text-teal-800": "color: #115e59",
    "border-teal-200": "border-color: #99f6e4",
    "bg-lime-100": "background-color: #ecfccb",
    "text-lime-800": "color: #3f6212",
    "border-lime-200": "border-color: #d9f99d",
    "bg-amber-100": "background-color: #fef3c7",
    "text-amber-800": "color: #92400e",
    "border-amber-200": "border-color: #fde68a",
    "bg-violet-100": "background-color: #ede9fe",
    "text-violet-800": "color: #5b21b6",
    "border-violet-200": "border-color: #ddd6fe",
    "bg-cyan-100": "background-color: #cffafe",
    "text-cyan-800": "color: #155e75",
    "border-cyan-200": "border-color: #a5f3fc",
    "bg-gray-100": "background-color: #f3f4f6",
    "text-gray-800": "color: #1f2937",
    "border-gray-200": "border-color: #e5e7eb",
  };

  return classes
    .split(" ")
    .map((c) => map[c] || "")
    .filter(Boolean)
    .join("; ");
}
