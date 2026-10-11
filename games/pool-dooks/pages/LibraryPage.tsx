"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { contentAction } from "@/lib/game-sdk/client";
import { PoolDookCard, type PoolDookSummary } from "../components/PoolDookCard";

export default function LibraryPage() {
  // null while loading
  const [stories, setStories] = useState<PoolDookSummary[] | null>(null);

  useEffect(() => {
    contentAction<PoolDookSummary[]>("pool_dooks", "list", { mine: true }, "GET")
      .then(setStories)
      .catch(() => setStories([]));
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Library</h1>
          {stories && (
            <p className="text-muted-foreground text-sm mt-0.5">
              {stories.length} pool dook{stories.length !== 1 ? "s" : ""}
            </p>
          )}
        </div>
        <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "gap-2")}>
          + New Pool Dook
        </Link>
      </div>

      {stories === null ? (
        <p className="text-center py-20 text-muted-foreground">Loading…</p>
      ) : stories.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
          <p className="text-lg">No pool dooks yet</p>
          <p className="text-sm mt-1">Create your first one or generate one with AI</p>
          <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "mt-4 inline-flex")}>
            Create Pool Dook
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {stories.map((ml) => (
            <PoolDookCard key={ml.id} poolDook={ml} showActions />
          ))}
        </div>
      )}
    </div>
  );
}
