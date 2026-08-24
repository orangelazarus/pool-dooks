"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface GuestJoinProps {
  shareCode: string;
  gameTitle: string;
}

export function GuestJoin({ shareCode, gameTitle }: GuestJoinProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);

    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();

      const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError || !anonData.user) {
        toast.error("Failed to join. Please try again.");
        return;
      }

      const userId = anonData.user.id;
      const baseName = name.trim();

      // Try to create profile; if username taken, append short suffix
      let username = baseName;
      let profileRes = await fetch("/api/auth/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, username }),
      });

      if (profileRes.status === 409) {
        const suffix = Math.random().toString(36).slice(2, 5);
        username = `${baseName}_${suffix}`;
        profileRes = await fetch("/api/auth/profile", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, username }),
        });
      }

      if (!profileRes.ok) {
        toast.error("Failed to set up your profile. Please try again.");
        await supabase.auth.signOut();
        return;
      }

      if (username !== baseName) {
        toast.info(`Joined as "${username}" (your name was taken)`);
      }

      // Reload so the server sees the new session and auto-joins
      window.location.reload();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">🎭</div>
          <CardTitle>{gameTitle}</CardTitle>
          <CardDescription>Enter your name to join the game</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoin} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || !name.trim()}>
              {loading ? "Joining..." : "Join Game"}
            </Button>
          </form>
          <div className="flex items-center gap-2 mt-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="mt-4 space-y-2">
            <Link
              href={`/login?next=/sessions/${shareCode}`}
              className={cn(buttonVariants({ variant: "outline" }), "w-full")}
            >
              Sign in
            </Link>
            <Link
              href={`/signup?next=/sessions/${shareCode}`}
              className={cn(buttonVariants({ variant: "ghost" }), "w-full text-sm")}
            >
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
