// Builds the contexts handed to game code. This is where a game's reach is
// decided: everything here is pinned to one gameType and one session, and it
// is the only place game-facing code touches the database, realtime or push.
import { and, eq } from "drizzle-orm";
import { db, sessions, sessionPlayers, profiles, answers } from "@/lib/db";
import type { Session } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { sendPushToUsers } from "@/lib/push/send";
import { sendSessionEvent } from "@/lib/realtime/server";
import { aiConfigured, runAi, type AiCaller } from "@/lib/ai/service";
import { GameError } from "./errors";
import { mutateState } from "./mutate";
import * as storage from "./storage";
import { afterCommit, executor } from "./tx";
import type {
  AiApi,
  AiUse,
  ContentApi,
  ContentContext,
  Deadline,
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
const MAX_DEADLINE_KEY = 64;

export async function resolveViewer(supabase: SupabaseServerClient): Promise<Viewer | null> {
  return (await resolveAccount(supabase)).viewer;
}

/**
 * The viewer, and when they became a signed-up account: when they confirmed
 * an email, which for a guest who signed up is later than when they arrived.
 * Kept out of Viewer, so games don't see it; AI limits use it.
 */
async function resolveAccount(supabase: SupabaseServerClient): Promise<{ viewer: Viewer | null; accountSince: Date | null }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { viewer: null, accountSince: null };
  const [profile] = await db.select({ username: profiles.username }).from(profiles).where(eq(profiles.id, user.id));
  const isGuest = user.is_anonymous ?? false;
  const since = user.email_confirmed_at ?? user.created_at;
  return {
    viewer: { id: user.id, username: profile?.username ?? "Unknown", isGuest },
    accountSince: isGuest || !since ? null : new Date(since),
  };
}

function contentApi<C>(gameType: string, viewer: Viewer | null): ContentApi<C> {
  const requireViewer = () => {
    if (!viewer) throw new GameError(401, "Unauthorized");
    return viewer;
  };
  return {
    create: (input) => storage.createContent<C>(gameType, requireViewer().id, input),
    get: (id) => storage.getVisibleContent<C>(gameType, id, viewer?.id ?? null),
    list: (options) => storage.listContent<C>(gameType, viewer?.id ?? null, options),
    update: (id, patch) => storage.updateContent<C>(gameType, id, requireViewer().id, patch),
    remove: (id) => storage.removeContent(gameType, id, requireViewer().id),
  };
}

/** The game's declared AI uses, metered by lib/ai/service. */
function aiApi(gameType: string, uses: Record<string, AiUse>, caller: AiCaller): AiApi {
  return {
    available: aiConfigured() && Object.keys(uses).length > 0,
    run: (use, request) =>
      runAi(gameType, use, Object.hasOwn(uses, use) ? uses[use] : undefined, request, caller) as Promise<never>,
  };
}

export async function buildContentContext<C>(
  gameType: string,
  options: { ai?: Record<string, AiUse>; ip: string }
): Promise<ContentContext<C>> {
  const { viewer, accountSince } = await resolveAccount(await createClient());
  return {
    gameType,
    viewer,
    content: contentApi<C>(gameType, viewer),
    ai: aiApi(gameType, options.ai ?? {}, { viewer, accountSince, ip: options.ip }),
  };
}

/** Builds what ctx.ai needs to know about the caller, for core's own AI routes. */
export async function resolveAiCaller(ip: string): Promise<AiCaller> {
  const { viewer, accountSince } = await resolveAccount(await createClient());
  return { viewer, accountSince, ip };
}

/** The roster, and who has left it. */
async function loadPlayers(sessionId: string): Promise<{ players: SessionPlayer[]; leftPlayers: SessionPlayer[] }> {
  // Through the action's transaction, so a player who has just left is already gone.
  const rows = await executor()
    .select({
      id: sessionPlayers.playerId,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
      joinOrder: sessionPlayers.joinOrder,
      isActive: sessionPlayers.isActive,
    })
    .from(sessionPlayers)
    .leftJoin(profiles, eq(sessionPlayers.playerId, profiles.id))
    .where(eq(sessionPlayers.sessionId, sessionId))
    .orderBy(sessionPlayers.joinOrder);
  const all = rows.map(({ isActive, ...r }) => ({
    player: { ...r, username: r.username ?? "Unknown", avatarUrl: r.avatarUrl ?? null },
    isActive: isActive !== false,
  }));
  return {
    players: all.filter((r) => r.isActive).map((r) => r.player),
    leftPlayers: all.filter((r) => !r.isActive).map((r) => r.player),
  };
}

/**
 * Context for one session. Refuses a session that belongs to a different game,
 * so a game can never be handed another game's session. Pass `viewer` when it
 * is already known, to rebuild the context without asking Supabase again.
 */
export async function buildSessionContext<C, S>(
  gameType: string,
  row: Session,
  known?: { viewer: Viewer | null }
): Promise<SessionContext<C, S>> {
  if (row.gameType !== gameType) throw new GameError(404, "Session not found");

  const [viewer, { players, leftPlayers }, content] = await Promise.all([
    known ? known.viewer : createClient().then(resolveViewer),
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
    leftPlayers,
    tokenOrder: (row.tokenOrder ?? []) as string[],
    currentTokenIndex: row.currentTokenIndex ?? 0,
    completedAt: row.completedAt,
    timerSeconds: row.timerSeconds ?? null,
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

  // Held until the action's transaction commits, so nobody hears about a
  // change that gets rolled back. Delivery problems never fail the action.
  const send = (event: string, payload: unknown) => afterCommit(() => sendSessionEvent(row.shareCode, event, payload));

  const announceDeadline = (deadline: Deadline | null) =>
    send("game:deadline", deadline && { at: deadline.at.toISOString(), key: deadline.key });

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

    deadline: {
      async set(inMs, key) {
        if (!Number.isFinite(inMs) || inMs < 0) throw new Error("deadline.set: inMs must be a non-negative number");
        if (!key) throw new Error("deadline.set: a key is required");
        const deadline = { at: new Date(Date.now() + inMs), key: key.slice(0, MAX_DEADLINE_KEY) };
        await storage.setDeadline(row.id, deadline);
        await announceDeadline(deadline);
        return deadline;
      },
      async clear() {
        await storage.setDeadline(row.id, null);
        await announceDeadline(null);
      },
      get: () => storage.getDeadline(row.id),
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
