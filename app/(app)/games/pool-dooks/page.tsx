import Link from "next/link";
import { db, poolDooks, profiles } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { PoolDookCard } from "@/components/pool-dook/PoolDookCard";
import { ThemeFilter } from "@/components/pool-dook/ThemeFilter";
import { THEMES } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

export default async function PoolDooksBrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string; search?: string }>;
}) {
  const { theme, search } = await searchParams;

  const rows = await db
    .select({
      id: poolDooks.id,
      title: poolDooks.title,
      theme: poolDooks.theme,
      tokens: poolDooks.tokens,
      aiGenerated: poolDooks.aiGenerated,
      extraWeird: poolDooks.extraWeird,
      createdAt: poolDooks.createdAt,
      authorId: poolDooks.authorId,
      author: { username: profiles.username },
    })
    .from(poolDooks)
    .leftJoin(profiles, eq(poolDooks.authorId, profiles.id))
    .where(eq(poolDooks.isPublic, true))
    .orderBy(desc(poolDooks.createdAt))
    .limit(48);

  const filtered = rows.filter((r) => {
    if (theme && r.theme !== theme) return false;
    if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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
          <Link href="/create" className={cn(buttonVariants(), "gap-2")}>
            + Create
          </Link>
        </div>
      </div>

      <ThemeFilter themes={THEMES} active={theme} />

      {filtered.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground">
          <p className="text-lg">No pool dooks found.</p>
          <Link href="/create" className={cn(buttonVariants(), "mt-4 inline-flex")}>
            Create the first one!
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {filtered.map((ml) => (
            <PoolDookCard key={ml.id} poolDook={ml} />
          ))}
        </div>
      )}
    </div>
  );
}
