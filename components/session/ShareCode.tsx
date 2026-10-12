"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";

export function ShareCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    toast.success("Share code copied!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyLink = async () => {
    await navigator.clipboard.writeText(`${window.location.origin}/sessions/${code}`);
    toast.success("Link copied!");
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <p className="text-sm text-muted-foreground">Share this code with friends</p>
      <div className="flex items-center gap-3">
        <div className="text-4xl sm:text-5xl font-mono font-bold tracking-[0.2em] bg-muted px-6 py-3 rounded-xl border-2 border-dashed">
          {code}
        </div>
        <Button
          size="icon"
          variant="outline"
          onClick={handleCopy}
          className="h-12 w-12"
        >
          {copied ? <Check className="h-5 w-5 text-secondary" /> : <Copy className="h-5 w-5" />}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Or{" "}
        <button onClick={handleCopyLink} className="font-mono text-foreground underline underline-offset-2 hover:opacity-70">
          copy the link
        </button>
      </p>
    </div>
  );
}
