import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { poolDooks } from "../schema";
import { eq, desc } from "drizzle-orm";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { PoolDookCard } from "../components/PoolDookCard";
import { cn } from "@/lib/utils";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rows = await db
    .select({
      id: poolDooks.id,
      title: poolDooks.title,
      theme: poolDooks.theme,
      tokens: poolDooks.tokens,
      isPublic: poolDooks.isPublic,
      aiGenerated: poolDooks.aiGenerated,
      extraWeird: poolDooks.extraWeird,
      createdAt: poolDooks.createdAt,
      authorId: poolDooks.authorId,
      author: { username: profiles.username },
    })
    .from(poolDooks)
    .leftJoin(profiles, eq(poolDooks.authorId, profiles.id))
    .where(eq(poolDooks.authorId, user.id))
    .orderBy(desc(poolDooks.createdAt));

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">My Library</h1>
          <p className="text-muted-foreground text-sm mt-0.5">{rows.length} pool dook{rows.length !== 1 ? "s" : ""}</p>
        </div>
        <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "gap-2")}>
          + New Pool Dook
        </Link>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-20 text-muted-foreground border-2 border-dashed rounded-lg">
          <p className="text-lg">No pool dooks yet</p>
          <p className="text-sm mt-1">Create your first one or generate one with AI</p>
          <Link href="/games/pool_dooks/create" className={cn(buttonVariants(), "mt-4 inline-flex")}>
            Create Pool Dook
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rows.map((ml) => (
            <PoolDookCard key={ml.id} poolDook={ml} showActions />
          ))}
        </div>
      )}
    </div>
  );
}
