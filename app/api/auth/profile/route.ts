import { NextRequest, NextResponse } from "next/server";
import { db, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const Schema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(3).max(30),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { userId, username } = parsed.data;

  // Check username uniqueness first for a clear error
  const [taken] = await db.select().from(profiles).where(eq(profiles.username, username));
  if (taken) {
    return NextResponse.json({ error: "Username already taken" }, { status: 409 });
  }

  // Upsert — if profile already exists (re-signup), just return it
  const [profile] = await db
    .insert(profiles)
    .values({ id: userId, username })
    .onConflictDoNothing()
    .returning();

  // If onConflictDoNothing fired, fetch the existing profile
  const result = profile ?? (await db.select().from(profiles).where(eq(profiles.id, userId)))[0];

  return NextResponse.json(result, { status: 201 });
}
