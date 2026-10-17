// Builds the contexts handed to game code. This is where a game's reach is
// decided: everything here is pinned to one gameType and one session, and it
// is the only place game-facing code touches the database, realtime or push.
import { and, eq } from "drizzle-orm";
import { db, sessions, sessionPlayers, profiles, answers } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUsers } from "@/lib/push/send";
import { GameError } from "./errors";
import { mutateState } from "./mutate";
import * as storage from "./storage";
import { afterCommit, executor } from "./tx";
import type {
  ContentApi,
  ContentContext,
  SessionContext,
  SessionInfo,
  SessionPlayer,
  StateApi,
  Viewer,
  ViewerRole,
} from "./types";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

// Realtime messages are delivered to every open browser; keep them small.
const MAX_BROADCAST_BYTES = 64 * 1024;
const MAX_PUSH_TITLE = 80;
const MAX_PUSH_BODY = 200;

export async function resolveViewer(supabase: SupabaseServerClient): Promise<Viewer | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const [profile] = await db.select({ username: profiles.username }).from(profiles).where(eq(profiles.id, user.id));
  return { id: user.id, username: profile?.username ?? "Unknown", isGuest: user.is_anonymous ?? false };
}

function contentApi<C>(gameType: string, viewer: Viewer | null): ContentApi<C> {
  const requireViewer = () => {
    if (!viewer) throw new GameError(401, "Unauthorized");
    return viewer;
  };
  return {
    create: (input) => storage.createContent<C>(gameType, requireViewer().id, input),
    get: (id) => storage.getContent<C>(gameType, id),
    list: (options) => storage.listContent<C>(gameType, viewer?.id ?? null, options),
    update: (id, patch) => storage.updateContent<C>(gameType, id, requireViewer().id, patch),
    remove: (id) => storage.removeContent(gameType, id, requireViewer().id),
  };
}

export async function buildContentContext<C>(gameType: string): Promise<ContentContext<C>> {
  const viewer = await resolveViewer(await createClient());
  return { gameType, viewer, content: contentApi<C>(gameType, viewer) };
}

async function loadPlayers(sessionId: string): Promise<SessionPlayer[]> {
  const rows = await db
    .select({
      id: sessionPlayers.playerId,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
      joinOrder: sessionPlayers.joinOrder,
    })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(and(eq(sessionPlayers.sessionId, sessionId), eq(sessionPlayers.isActive, true)))
    .orderBy(sessionPlayers.joinOrder);
  return rows.map((r) => ({ ...r, username: r.username ?? "Unknown", avatarUrl: r.avatarUrl ?? null }));
}

/**
 * Context for one session. Refuses a session that belongs to a different game,
 * so a game can never be handed another game's session.
 */
export async function buildSessionContext<C, S>(gameType: string, row: Session): Promise<SessionContext<C, S>> {
  if (row.gameType !== gameType) throw new GameError(404, "Session not found");

  const supabase = await createClient();
  const [viewer, players, content] = await Promise.all([
    resolveViewer(supabase),
    loadPlayers(row.id),
    row.gameContentId ? storage.getContent<C>(gameType, row.gameContentId) : null,
  ]);
  if (!content) throw new GameError(404, "This game's content no longer exists");

  const session: SessionInfo<C> = {
    shareCode: row.shareCode,
    status: row.status as SessionInfo<C>["status"],
    hostId: row.hostId,
    isPublic: row.isPublic,
    currentPlayerId: row.currentPlayerId,
    players,
    tokenOrder: (row.tokenOrder ?? []) as string[],
    currentTokenIndex: row.currentTokenIndex ?? 0,
    completedAt: row.completedAt,
    content,
  };

  const state: StateApi<S> = {
    get: () => storage.getState<S>(gameType, row.id),
    init: (data) => storage.initState<S>(gameType, row.id, data),
    update: (data, { expectedVersion }) => storage.updateState<S>(gameType, row.id, data, expectedVersion),
    mutate: (change, { attempts } = {}) => mutateState<S>(state, change, attempts),
  };

  const isPlayer = !!viewer && players.some((p) => p.id === viewer.id);
  const role: ViewerRole | null = isPlayer ? "player" : row.isPublic ? "observer" : null;

  const channel = () => supabase.channel(`session:${row.shareCode}`);
  // Held until the action's transaction commits, so nobody hears about a
  // change that gets rolled back. Delivery problems never fail the action.
  const send = (event: string, payload: unknown) =>
    afterCommit(() =>
      channel().send({ type: "broadcast", event, payload: { type: event, payload } }).then(() => {}, () => {})
    );

  return {
    gameType,
    viewer,
    role,
    session,
    content: contentApi<C>(gameType, viewer),

    state,

    async answers() {
      return executor()
        .select({
          tokenId: answers.tokenId,
          value: answers.value,
          playerId: answers.playerId,
          username: profiles.username,
        })
        .from(answers)
        .leftJoin(profiles, eq(answers.playerId, profiles.id))
        .where(eq(answers.sessionId, row.id));
    },

    turn: {
      async set(playerId) {
        if (!players.some((p) => p.id === playerId)) throw new GameError(400, "That player isn't in this game");
        await executor().update(sessions).set({ currentPlayerId: playerId }).where(eq(sessions.id, row.id));
        session.currentPlayerId = playerId;
      },
    },

    async finish() {
      const completedAt = new Date();
      const [done] = await executor()
        .update(sessions)
        .set({ status: "completed", completedAt })
        .where(and(eq(sessions.id, row.id), eq(sessions.status, "in_progress")))
        .returning({ id: sessions.id });
      if (!done) return false;

      session.status = "completed";
      session.completedAt = completedAt;
      await send("session:completed", { completedAt: completedAt.toISOString() });
      await send("session:revealed", {});
      return true;
    },

    async broadcast(name, data) {
      storage.assertSize(data, "This update", MAX_BROADCAST_BYTES);
      await send("game:event", { name, data });
    },

    async notify(to, message) {
      const wanted = to === "others" ? players.map((p) => p.id).filter((id) => id !== viewer?.id) : [to].flat();
      // Only this session's players can be reached, whatever ids a game passes.
      const recipients = [...new Set(wanted)].filter((id) => players.some((p) => p.id === id));
      if (recipients.length === 0) return;
      const page = session.status === "completed" ? "reveal" : "play";
      await afterCommit(() =>
        sendPushToUsers(recipients, {
          title: message.title.slice(0, MAX_PUSH_TITLE),
          body: message.body.slice(0, MAX_PUSH_BODY),
          url: `/sessions/${row.shareCode}/${page}`,
        }).catch(() => {})
      );
    },
  };
}
