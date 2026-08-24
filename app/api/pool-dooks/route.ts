import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, poolDooks, profiles } from "@/lib/db";
import { eq, desc, and, ilike } from "drizzle-orm";
import { z } from "zod";
import { serializeEditorContent } from "@/lib/editor/serialize";

const CreateSchema = z.object({
  title: z.string().min(1).max(200),
  theme: z.string().min(1),
  bodyJson: z.record(z.string(), z.unknown()),
  isPublic: z.boolean().optional().default(true),
  aiGenerated: z.boolean().optional().default(false),
  extraWeird: z.boolean().optional().default(false),
  importSource: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const theme = searchParams.get("theme");
  const search = searchParams.get("search");
  const mine = searchParams.get("mine") === "true";

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const conditions = [];
  if (theme) conditions.push(eq(poolDooks.theme, theme));
  if (search) conditions.push(ilike(poolDooks.title, `%${search}%`));
  if (mine && user) conditions.push(eq(poolDooks.authorId, user.id));
  else conditions.push(eq(poolDooks.isPublic, true));

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
      author: {
        username: profiles.username,
        avatarUrl: profiles.avatarUrl,
      },
    })
    .from(poolDooks)
    .leftJoin(profiles, eq(poolDooks.authorId, profiles.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(poolDooks.createdAt))
    .limit(50);

  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { title, theme, bodyJson, isPublic, aiGenerated, extraWeird, importSource } = parsed.data;
  const { bodyText, tokens } = serializeEditorContent(bodyJson as Parameters<typeof serializeEditorContent>[0]);

  const [row] = await db
    .insert(poolDooks)
    .values({
      authorId: user.id,
      title,
      theme,
      bodyJson,
      bodyText,
      tokens,
      isPublic,
      aiGenerated,
      extraWeird,
      importSource,
    })
    .returning();

  return NextResponse.json(row, { status: 201 });
}
