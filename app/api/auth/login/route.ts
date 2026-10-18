import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, profiles } from "@/lib/db";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const Schema = z.object({
  /** An email address, or a username. */
  identifier: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(200),
});

// One answer for every failure, so the response never says whether a username
// or email exists.
const WRONG = "Wrong username, email or password";

/**
 * Signs in with an email or a username. A username is turned into its email
 * here on the server, which is the only place that ever sees it; the session
 * cookies are set on the response by the server client.
 */
export async function POST(req: NextRequest) {
  const parsed = Schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: WRONG }, { status: 400 });
  const { identifier, password } = parsed.data;

  let email = identifier;
  if (!identifier.includes("@")) {
    const [profile] = await db.select({ id: profiles.id }).from(profiles).where(eq(profiles.username, identifier));
    const found = profile && (await (await createServiceClient()).auth.admin.getUserById(profile.id)).data.user?.email;
    if (!found) return NextResponse.json({ error: WRONG }, { status: 401 });
    email = found;
  }

  const { error } = await (await createClient()).auth.signInWithPassword({ email, password });
  if (error) return NextResponse.json({ error: WRONG }, { status: 401 });
  return NextResponse.json({ ok: true });
}
