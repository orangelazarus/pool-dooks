"use client";
import { useState, useRef } from "react";
import type { JSONContent } from "@tiptap/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { contentAction } from "@/lib/game-sdk/client";
import { IMAGE_TYPES, MAX_IMAGE_BYTES } from "../schema";
import { Upload, Camera, Sparkles } from "lucide-react";

interface Draft {
  bodyJson: JSONContent;
  title?: string;
}

/** The file's bytes as base64, without the data-URL prefix. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error("Couldn't read that image"));
    reader.readAsDataURL(file);
  });
}

interface ImportDialogProps {
  open: boolean;
  onClose: () => void;
  onImport: (data: { bodyJson: JSONContent; title?: string }) => void;
}

export function ImportDialog({ open, onClose, onImport }: ImportDialogProps) {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const handleTextImport = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const data = await contentAction<Draft>("pool_dooks", "import", { text });
      onImport({ bodyJson: data.bodyJson });
    } catch {
      toast.error("Import failed");
    } finally {
      setLoading(false);
    }
  };

  const handleAiEnhance = async () => {
    if (!text.trim()) return;
    setLoading(true);
    try {
      const data = await contentAction<Draft>("pool_dooks", "enhance", { text });
      onImport({ bodyJson: data.bodyJson, title: data.title });
      toast.success("Blanks added by AI!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Enhancement failed";
      toast.error(msg.includes("rate_limit") ? "Rate limit — wait a moment and try again." : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setScanPreview(url);
  };

  const handleImageScan = async () => {
    const file = imageRef.current?.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      if (!(IMAGE_TYPES as readonly string[]).includes(file.type)) {
        throw new Error("Unsupported image type. Use JPG, PNG, GIF, or WebP.");
      }
      if (file.size > MAX_IMAGE_BYTES) throw new Error("That image is too large — use one under 5 MB.");
      const data = await contentAction<Draft>("pool_dooks", "scan", {
        mediaType: file.type,
        data: await fileToBase64(file),
      });
      onImport({ bodyJson: data.bodyJson, title: data.title });
      toast.success("Page scanned successfully!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Scan failed";
      toast.error(msg.includes("rate_limit") ? "Rate limit — wait a moment and try again." : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      // An exported story is JSON; anything else is treated as plain text.
      const fileText = await file.text();
      let payload: { json: unknown } | { text: string };
      try {
        payload = { json: JSON.parse(fileText) };
      } catch {
        payload = { text: fileText };
      }
      const data = await contentAction<Draft>("pool_dooks", "import", payload);
      onImport({ bodyJson: data.bodyJson });
    } catch {
      toast.error("Import failed");
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Pool Dook</DialogTitle>
          <DialogDescription>
            Paste plain text with [blanks] or upload a file.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="scan">
          <TabsList className="w-full">
            <TabsTrigger value="scan" className="flex-1">Scan Image</TabsTrigger>
            <TabsTrigger value="text" className="flex-1">Paste Text</TabsTrigger>
            <TabsTrigger value="file" className="flex-1">Upload File</TabsTrigger>
          </TabsList>

          <TabsContent value="scan" className="mt-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Take a photo of a printed Pool Dooks page and upload it. AI will extract the story and all blanks automatically.
            </p>
            <div
              className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => imageRef.current?.click()}
            >
              {scanPreview ? (
                // A blob: URL for a photo still on this device. next/image can't optimize
                // one, and the user's photos shouldn't go through the image optimizer anyway.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={scanPreview} alt="Preview" className="max-h-48 mx-auto rounded object-contain" />
              ) : (
                <>
                  <Camera className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium">Click to upload image</p>
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG, WebP supported</p>
                </>
              )}
              <input
                ref={imageRef}
                type="file"
                accept="image/jpeg,image/jpg,image/png,image/webp,image/gif"
                className="hidden"
                onChange={handleImageSelect}
              />
            </div>
            {scanPreview && (
              <Button onClick={handleImageScan} disabled={loading} className="w-full gap-2">
                <Camera className="h-4 w-4" />
                {loading ? "Scanning..." : "Scan with AI"}
              </Button>
            )}
          </TabsContent>

          <TabsContent value="text" className="space-y-3 mt-4">
            <div className="space-y-1.5">
              <Label>
                Paste your text. Use [noun], [verb], [adjective] for blanks — or paste raw text and let AI pick them.
              </Label>
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="The [adjective] [noun] jumped over the [adjective] fence."
                className="h-40 font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleTextImport} disabled={loading || !text.trim()} variant="outline" className="flex-1">
                {loading ? "Importing..." : "Import"}
              </Button>
              <Button onClick={handleAiEnhance} disabled={loading || !text.trim()} className="flex-1 gap-1.5">
                <Sparkles className="h-3.5 w-3.5" />
                {loading ? "Thinking..." : "Add blanks with AI"}
              </Button>
            </div>
          </TabsContent>

          <TabsContent value="file" className="mt-4">
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:bg-muted/50 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <Upload className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm font-medium">Click to upload</p>
              <p className="text-xs text-muted-foreground mt-1">
                .txt or .json files supported
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".txt,.json"
                className="hidden"
                onChange={handleFileImport}
              />
            </div>
            {loading && <p className="text-center text-sm text-muted-foreground mt-2">Importing...</p>}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
