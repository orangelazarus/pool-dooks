"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { contentAction } from "@/lib/game-sdk/client";
import { THEMES } from "../schema";
import { PoolDookCard, type PoolDookSummary } from "../components/PoolDookCard";
import { ThemeFilter } from "../components/ThemeFilter";

export default function BrowsePage() {
  const searchParams = useSearchParams();
  const theme = searchParams.get("theme") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  // null while loading
  const [stories, setStories] = useState<PoolDookSummary[] | null>(null);

  useEffect(() => {
    let current = true;
    contentAction<PoolDookSummary[]>("pool_dooks", "list", { theme, search }, "GET")
      .then((rows) => current && setStories(rows))
      .catch(() => current && setStories([]));
    return () => {
      current = false;
    };
  }, [theme, search]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pool Dooks</h1>
          <p className="text-muted-foreground mt-1">Fill in the blanks, laugh together</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="/sessions/new" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
            Join by code
          </Link>
          <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "gap-2")}>
            + Create
          </Link>
        </div>
      </div>

      <ThemeFilter themes={THEMES} active={theme} />

      {stories === null ? (
        <p className="text-center py-20 text-muted-foreground">Loading…</p>
      ) : stories.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No pool dooks found.</p>
          <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "mt-4 inline-flex")}>
            Create the first one!
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {stories.map((ml) => (
            <PoolDookCard key={ml.id} poolDook={ml} />
          ))}
        </div>
      )}
    </div>
  );
}
