"use client";
export const dynamic = "force-dynamic";
import { useState, useCallback, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { JSONContent } from "@tiptap/react";
import { PoolDookEditor } from "../components/PoolDookEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { THEMES } from "../schema";
import { toast } from "sonner";
import { Sparkles, Upload, Save, Zap } from "lucide-react";
import { ImportDialog } from "../components/ImportDialog";

const THEME_LABELS: Record<string, string> = {
  everyday_life: "Everyday Life",
  entertainment: "Entertainment",
  sports: "Sports",
  sci_fi: "Sci-Fi",
  fantasy: "Fantasy",
  food: "Food",
  travel: "Travel",
  custom: "Custom",
};

export default function CreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const editId = searchParams.get("edit");

  const [title, setTitle] = useState("");
  const [theme, setTheme] = useState<string>("everyday_life");
  const [isPublic, setIsPublic] = useState(true);
  const [content, setContent] = useState<JSONContent | undefined>();
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [extraWeird, setExtraWeird] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [isEdit, setIsEdit] = useState(false);

  useEffect(() => {
    if (!editId) return;
    setIsEdit(true);
    fetch(`/api/games/pool_dooks/${editId}`)
      .then((r) => r.json())
      .then((data) => {
        setTitle(data.title);
        setTheme(data.theme);
        setIsPublic(data.isPublic);
        setContent(data.bodyJson as JSONContent);
      })
      .catch(() => toast.error("Failed to load pool dook"));
  }, [editId]);

  const handleEnhance = async () => {
    if (!content) { toast.error("Paste some text into the editor first"); return; }

    const plainText = extractPlainText(content);
    if (!plainText.trim()) { toast.error("No text to enhance"); return; }

    setGenerating(true);
    try {
      const res = await fetch("/api/games/pool_dooks/ai/enhance-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: plainText }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Enhancement failed");
      if (!title && data.title) setTitle(data.title);
      setContent(data.bodyJson);
      toast.success("Blanks added! Review and edit as needed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Enhancement failed";
      const isRateLimit = msg.includes("rate_limit") || msg.includes("429");
      toast.error(isRateLimit ? "Rate limit reached — wait a moment and try again." : msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleGenerate = async () => {
    if (!theme) { toast.error("Select a theme first"); return; }
    setGenerating(true);
    try {
      const res = await fetch("/api/games/pool_dooks/ai/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theme, extraWeird, title: title || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setTitle(data.title);
      setContent(data.bodyJson as JSONContent);
      toast.success("Mad lib generated! Review and edit as needed.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      const isRateLimit = msg.includes("rate_limit") || msg.includes("429");
      toast.error(isRateLimit ? "Rate limit reached — wait a moment and try again." : msg);
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    if (!title.trim()) { toast.error("Add a title"); return; }
    if (!content) { toast.error("Add some content"); return; }
    setSaving(true);
    try {
      const url = isEdit ? `/api/games/pool_dooks/${editId}` : "/api/games/pool_dooks";
      const method = isEdit ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, theme, bodyJson: content, isPublic }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success(isEdit ? "Mad lib updated!" : "Mad lib created!");
      router.push("/games/pool_dooks/library");
    } catch {
      toast.error("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleImport = useCallback((imported: { bodyJson: JSONContent; title?: string }) => {
    setContent(imported.bodyJson);
    if (imported.title) setTitle(imported.title);
    setShowImport(false);
    toast.success("Imported successfully!");
  }, []);

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{isEdit ? "Edit Pool Dook" : "Create Pool Dook"}</h1>
        <Button onClick={handleSave} disabled={saving} className="gap-2">
          <Save className="h-4 w-4" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-6 lg:order-2">
          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm">Settings</h3>

            <div className="space-y-1.5">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="My Funny Story"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Theme</Label>
              <Select value={theme} onValueChange={(v) => setTheme(v ?? "everyday_life")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THEMES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {THEME_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <Label htmlFor="public" className="cursor-pointer">Public</Label>
              <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
          </div>

          <div className="border rounded-lg p-4 space-y-4">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-violet-500" />
              AI Generator
            </h3>

            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="weird" className="cursor-pointer flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-orange-500" />
                  Extra Weird
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">Absurdist &amp; surreal mode</p>
              </div>
              <Switch id="weird" checked={extraWeird} onCheckedChange={setExtraWeird} />
            </div>

            <Button
              onClick={handleGenerate}
              disabled={generating}
              variant="outline"
              className="w-full gap-2"
            >
              <Sparkles className="h-4 w-4" />
              {generating ? "Generating..." : "Generate with AI"}
            </Button>
            <Button
              onClick={handleEnhance}
              disabled={generating}
              variant="outline"
              className="w-full gap-2"
            >
              <Sparkles className="h-4 w-4 text-violet-500" />
              {generating ? "Thinking..." : "Add blanks to pasted text"}
            </Button>
          </div>

          <Button
            variant="outline"
            className="w-full gap-2"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>

        <div className="lg:col-span-2 lg:order-1 space-y-3">
          <div className="flex items-center gap-2">
            <Label>Story</Label>
            <Badge variant="secondary" className="text-xs">
              Use toolbar to insert blanks
            </Badge>
          </div>
          <PoolDookEditor content={content} onChange={setContent} />
          <p className="text-xs text-muted-foreground">
            Type your story and click &ldquo;Insert Blank&rdquo; to add fill-in-the-blank spots.
          </p>
        </div>
      </div>

      <ImportDialog
        open={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
      />
    </div>
  );
}

function extractPlainText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "blank") return node.attrs?.label ?? "";
  if (node.type === "paragraph") {
    return (node.content?.map(extractPlainText).join("") ?? "") + "\n";
  }
  return node.content?.map(extractPlainText).join("") ?? "";
}
