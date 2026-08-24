"use client";
import { type Editor } from "@tiptap/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TOKEN_TYPES, TOKEN_COLORS } from "./BlankNode";
import { Plus, Link } from "lucide-react";
import type { JSONContent } from "@tiptap/react";

function getExistingBlanks(editor: Editor) {
  const doc = editor.getJSON();
  const blanks: Array<{ id: string; label: string; tokenType: string }> = [];
  const seenIds = new Set<string>();

  function traverse(node: JSONContent) {
    if (node.type === "blank" && node.attrs?.id && !seenIds.has(node.attrs.id as string)) {
      seenIds.add(node.attrs.id as string);
      blanks.push({
        id: node.attrs.id as string,
        label: node.attrs.label as string,
        tokenType: node.attrs.tokenType as string,
      });
    }
    if (node.content) node.content.forEach(traverse);
  }

  traverse(doc);
  return blanks;
}

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const [tokenType, setTokenType] = useState<string>("noun");
  const [linkOpen, setLinkOpen] = useState(false);

  if (!editor) return null;

  const handleInsert = () => {
    const finalLabel = label.trim() || tokenType;
    editor.chain().focus().insertBlank({ label: finalLabel, tokenType }).run();
    setLabel("");
    setOpen(false);
  };

  const handleLinkOpen = (nextOpen: boolean) => {
    setLinkOpen(nextOpen);
  };

  const existingBlanks = linkOpen ? getExistingBlanks(editor) : [];

  return (
    <div className="flex items-stretch gap-2 p-2 border-b bg-muted/30">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger className="inline-flex items-center gap-1 self-stretch rounded-md border border-border bg-background px-2.5 text-[0.8rem] text-sm font-medium transition-colors hover:bg-muted">
          <Plus className="h-3.5 w-3.5" />
          Insert Blank
        </PopoverTrigger>
        <PopoverContent className="w-72" align="start">
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Type
              </label>
              <Select value={tokenType} onValueChange={(v) => setTokenType(v ?? "noun")}>
                <SelectTrigger className="h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TOKEN_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium border ${TOKEN_COLORS[t]}`}>
                        {t}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Label (optional)
              </label>
              <Input
                className="h-8 text-sm"
                placeholder={`e.g. "silly ${tokenType}"`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInsert()}
              />
            </div>
            <Button size="sm" className="w-full" onClick={handleInsert}>
              Insert
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Popover open={linkOpen} onOpenChange={handleLinkOpen}>
        <PopoverTrigger className="inline-flex items-center gap-1 self-stretch rounded-md border border-border bg-background px-2.5 text-[0.8rem] text-sm font-medium transition-colors hover:bg-muted">
          <Link className="h-3.5 w-3.5" />
          Reuse Blank
        </PopoverTrigger>
        <PopoverContent className="w-64" align="start">
          {existingBlanks.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-2">
              No blanks in the story yet.
            </p>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground mb-2">
                Insert a linked copy — same answer will fill all occurrences.
              </p>
              {existingBlanks.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-muted text-left text-sm"
                  onClick={() => {
                    editor.chain().focus().insertLinkedBlank(b).run();
                    setLinkOpen(false);
                  }}
                >
                  <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium border shrink-0 ${TOKEN_COLORS[b.tokenType] ?? TOKEN_COLORS.custom}`}>
                    {b.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <div className="self-stretch w-px bg-border" />
      <div className="flex flex-wrap gap-1">
        {[...TOKEN_TYPES].sort().map((t) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              editor.chain().focus().insertBlank({ label: t, tokenType: t }).run()
            }
            className={`px-2 py-0.5 rounded-full text-xs font-medium border ${TOKEN_COLORS[t]} hover:opacity-80 transition-opacity`}
          >
            + {t}
          </button>
        ))}
      </div>
    </div>
  );
}
