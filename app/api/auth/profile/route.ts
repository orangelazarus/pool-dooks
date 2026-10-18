import { NextRequest, NextResponse } from "next/server";
import { db, profiles } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Schema = z.object({
  userId: z.string().uuid(),
  username: z.string().min(3).max(30),
});

// How long after signing up an account without a session (an email sign-up
// waiting for confirmation) may still be given its first profile.
const NEW_ACCOUNT_MS = 15 * 60 * 1000;

/**
 * Only the account itself may get a profile: the caller's own session, or an
 * account created moments ago that has no profile yet (an email sign-up still
 * waiting for confirmation, or a guest whose old session cookie is still set
 * while they sign up). So nobody can attach usernames to other people's
 * accounts or to made-up ids.
 */
async function refuseUnlessOwnNewAccount(userId: string): Promise<NextResponse | null> {
  const { data: { user } } = await (await createClient()).auth.getUser();
  if (user?.id === userId) return null;

  const { data } = await (await createServiceClient()).auth.admin.getUserById(userId);
  const created = data.user ? Date.parse(data.user.created_at) : NaN;
  if (!(Date.now() - created < NEW_ACCOUNT_MS)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [existing] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.id, userId));
  return existing ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) : null;
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { userId, username } = parsed.data;
  const refused = await refuseUnlessOwnNewAccount(userId);
  if (refused) return refused;

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
