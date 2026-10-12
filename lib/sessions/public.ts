import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { db, sessions, sessionPlayers, profiles } from "@/lib/db";
import { listPlugins } from "@/lib/games/registry";
import { expireStaleLobbies, lobbyExpiresAt } from "./expiry";

export interface OpenSession {
  shareCode: string;
  gameDisplayName: string;
  hostName: string;
  playerCount: number;
  maxPlayers: number;
  /** Lobbies only: whole minutes until it closes if the game hasn't started. */
  closesInMinutes: number | null;
}

// Nothing ever expires an abandoned lobby or game, so only recent ones are listed.
const LISTING_WINDOW_HOURS = 24;
const LISTING_LIMIT = 50;

/** Public sessions for the home page: lobbies with room, and games in progress. */
export async function listOpenSessions(): Promise<{ joinable: OpenSession[]; watchable: OpenSession[] }> {
  // Close abandoned lobbies first, so they never make the list.
  await expireStaleLobbies();

  const plugins = new Map(listPlugins().map((p) => [p.gameType, p]));
  const since = new Date(Date.now() - LISTING_WINDOW_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({
      shareCode: sessions.shareCode,
      gameType: sessions.gameType,
      status: sessions.status,
      isPublic: sessions.isPublic,
      createdAt: sessions.createdAt,
      hostName: profiles.username,
      playerCount: sql<number>`(select count(*)::int from ${sessionPlayers} where ${sessionPlayers.sessionId} = ${sessions.id})`,
    })
    .from(sessions)
    .leftJoin(profiles, eq(sessions.hostId, profiles.id))
    .where(
      and(
        eq(sessions.isPublic, true),
        inArray(sessions.status, ["lobby", "in_progress"]),
        gt(sql`coalesce(${sessions.startedAt}, ${sessions.createdAt})`, since)
      )
    )
    .orderBy(desc(sql`coalesce(${sessions.startedAt}, ${sessions.createdAt})`))
    .limit(LISTING_LIMIT);

  const joinable: OpenSession[] = [];
  const watchable: OpenSession[] = [];
  for (const row of rows) {
    const plugin = plugins.get(row.gameType);
    if (!plugin) continue;
    const expiresAt = lobbyExpiresAt(row);
    const entry: OpenSession = {
      shareCode: row.shareCode,
      gameDisplayName: plugin.displayName,
      hostName: row.hostName ?? "Unknown",
      playerCount: row.playerCount,
      maxPlayers: plugin.maxPlayers,
      closesInMinutes: expiresAt ? Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 60_000)) : null,
    };
    if (row.status === "in_progress") watchable.push(entry);
    else if (row.playerCount < plugin.maxPlayers) joinable.push(entry);
  }
  return { joinable, watchable };
}
