import type { Metadata } from "next";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db, sessions, profiles } from "@/lib/db";
import { getPlugin } from "@/lib/games/registry";
import { lobbyExpiresAt } from "./expiry";

const SITE = "Pool Dooks";

/**
 * The preview a chat app shows when someone pastes a session link: who is
 * hosting, which game, and its settings (the same subtitle the lobby shows).
 * Crawlers are logged out, so this says only what the guest join page already
 * shows anyone who opens the link.
 */
export async function sessionLinkMetadata(code: string): Promise<Metadata> {
  const [row] = await db
    .select({ session: sessions, host: profiles.username })
    .from(sessions)
    .leftJoin(profiles, eq(sessions.hostId, profiles.id))
    .where(eq(sessions.shareCode, code));
  if (!row) return {};

  const { session, host } = row;
  const plugin = getPlugin(session.gameType);
  const game = plugin.displayName;

  // Read-only: a link preview shouldn't be what closes a lobby, so a stale
  // public lobby is described as expired without being marked so.
  const expiresAt = lobbyExpiresAt(session);
  const expired = session.status === "expired" || (expiresAt !== null && expiresAt.getTime() < Date.now());

  let title: string;
  let description: string;
  if (expired) {
    title = host ? `${host}'s game of ${game} has expired` : `This game of ${game} has expired`;
    description = "Start a new one on Pool Dooks.";
  } else if (session.status === "in_progress") {
    title = host ? `${host}'s game of ${game} is under way` : `A game of ${game} is under way`;
    description = session.isPublic ? "Open the link to watch." : plugin.description;
  } else if (session.status === "completed") {
    title = host ? `${host}'s game of ${game} is over` : `A game of ${game} is over`;
    description = "See how it ended.";
  } else {
    const subtitle = (await plugin.getLobbyMeta?.(session).catch(() => null))?.subtitle;
    title = host ? `${host} invited you to play ${game}` : `You're invited to play ${game}`;
    description = [subtitle, `Join with code ${code}. No account needed.`].filter(Boolean).join(" · ");
  }

  // Absolute URLs from the request's own host: NEXT_PUBLIC_APP_URL is baked in
  // at build time, and builds are made on a laptop where it is localhost.
  const h = await headers();
  const origin = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? (origin?.startsWith("localhost") ? "http" : "https");
  const metadataBase = origin ? new URL(`${proto}://${origin}`) : undefined;

  const image = { url: "/icons/icon-512.png", width: 512, height: 512, alt: SITE };
  return {
    metadataBase,
    // The tab title stays neutral: the host and players see it too, and the
    // invitation wording is for the person the link is sent to.
    title: `${game} · ${SITE}`,
    description,
    openGraph: {
      title,
      description,
      siteName: SITE,
      type: "website",
      url: `/sessions/${code}`,
      images: [image],
    },
    twitter: { card: "summary", title, description, images: [image] },
  };
}
