"use client";
import { createClient } from "@/lib/supabase/client";

export const GUEST_NAME_MIN = 3;
export const GUEST_NAME_MAX = 30;

export type GuestSignIn =
  | { ok: true; username: string; renamed: boolean }
  | { ok: false; error: string };

async function createProfile(userId: string, username: string) {
  return fetch("/api/auth/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, username }),
  });
}

/**
 * Gives a logged-out visitor an anonymous account and a profile under `name`.
 * After this they are a signed-in user as far as the rest of the app can tell.
 */
export async function signInAsGuest(name: string): Promise<GuestSignIn> {
  const baseName = name.trim();
  if (baseName.length < GUEST_NAME_MIN) {
    return { ok: false, error: `Your name needs at least ${GUEST_NAME_MIN} characters` };
  }

  const supabase = createClient();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) return { ok: false, error: "Couldn't set you up as a guest. Please try again." };

  // If the name is taken, append a short suffix rather than making them pick again.
  let username = baseName;
  let res = await createProfile(data.user.id, username);
  if (res.status === 409) {
    username = `${baseName}_${Math.random().toString(36).slice(2, 5)}`;
    res = await createProfile(data.user.id, username);
  }

  if (!res.ok) {
    await supabase.auth.signOut();
    return { ok: false, error: "Failed to set up your profile. Please try again." };
  }
  return { ok: true, username, renamed: username !== baseName };
}

/** Only follow same-site paths from a `?next=` parameter. */
export function safeNextPath(next: string | null, fallback = "/home"): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}
