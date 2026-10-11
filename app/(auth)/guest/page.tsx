"use client";
import { Suspense, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { signInAsGuest, safeNextPath, GUEST_NAME_MIN, GUEST_NAME_MAX } from "@/lib/auth/guest";

function GuestForm() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  const nextPath = safeNextPath(useSearchParams().get("next"));
  const authHref = (page: "login" | "signup") => `/${page}?next=${encodeURIComponent(nextPath)}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const result = await signInAsGuest(name);
    if (!result.ok) {
      toast.error(result.error);
      setLoading(false);
      return;
    }
    // Full navigation so the server sees the new session.
    window.location.assign(nextPath);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="text-4xl mb-2">🎭</div>
          <CardTitle>Pick a name to play</CardTitle>
          <CardDescription>No account needed — this is how other players will see you</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name">Your name</Label>
              <Input
                id="name"
                type="text"
                placeholder="e.g. Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                minLength={GUEST_NAME_MIN}
                maxLength={GUEST_NAME_MAX}
                required
                autoFocus
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading || name.trim().length < GUEST_NAME_MIN}>
              {loading ? "Setting up..." : "Play as guest"}
            </Button>
          </form>
          <div className="flex items-center gap-2 mt-4">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <div className="mt-4 space-y-2">
            <Link href={authHref("login")} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
              Sign in
            </Link>
            <Link href={authHref("signup")} className={cn(buttonVariants({ variant: "ghost" }), "w-full text-sm")}>
              Create account
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for this page to prerender.
export default function GuestPage() {
  return (
    <Suspense>
      <GuestForm />
    </Suspense>
  );
}
