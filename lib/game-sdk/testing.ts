// Runs a game in memory, for tests: no HTTP, no database, no realtime, no
// push. Every action goes through the same access and input checks as the
// real route (./checks), and through the same transaction rules as ./tx — a
// handler that throws an unexpected error leaves nothing behind, a GameError
// keeps what was written before it, and broadcasts and notifications are
// recorded only once the action "commits".
//
//   const t = createTestSession(plugin, { players: ["ann", "bob", "cat"], content: { rounds: 5 } });
//   await t.start();
//   await t.as("ann").act("vote", { choiceId: "c1" });
//   expect(t.state()).toMatchObject({ ... });
//
// Only for *.test.ts files; never import it from game code that ships.
import { checkSessionAccess, parseInput } from "./checks";
import { GameError, StateConflictError } from "./errors";
import { mutateState } from "./mutate";
import type {
  ContentApi,
  ContentRecord,
  Deadline,
  GameDefinition,
  GivenAnswer,
  PushMessage,
  SessionContext,
  SessionInfo,
  SessionPlayer,
  StateApi,
  Viewer,
  ViewerRole,
} from "./types";

export interface TestSessionOptions<C> {
  /** A number of players (ids p1, p2…) or their usernames, which are also their ids. In join order. */
  players: number | string[];
  /** The content row's `data`. */
  content: C;
  title?: string;
  /** Which player hosts. Default the first. */
  hostIndex?: number;
  isPublic?: boolean;
  /** The host's timer choice, for a game with `timer`. Default null (off). */
  timerSeconds?: number | null;
}

export interface RecordedBroadcast {
  name: string;
  data: unknown;
}

export interface RecordedNotification extends PushMessage {
  to: string[];
}

interface Store<S> {
  status: SessionInfo<unknown>["status"];
  currentPlayerId: string | null;
  tokenOrder: string[];
  completedAt: Date | null;
  state: { data: S; version: number } | null;
  answers: Array<{ tokenId: string; value: string; playerId: string }>;
  deadline: Deadline | null;
}

const clone = <T>(value: T): T => structuredClone(value);

/** A game's exported `plugin` (from defineGame), or a bare definition. */
type Game<C, S> = { definition: GameDefinition<C, S> } | GameDefinition<C, S>;

export function createTestSession<C, S>(game: Game<C, S>, options: TestSessionOptions<C>) {
  const def: GameDefinition<C, S> = "definition" in game ? game.definition : game;
  const names = typeof options.players === "number"
    ? Array.from({ length: options.players }, (_, i) => `p${i + 1}`)
    : options.players;
  const players: SessionPlayer[] = names.map((name, i) => ({ id: name, username: name, avatarUrl: null, joinOrder: i }));
  // Both change when players leave.
  let hostId = players[options.hostIndex ?? 0].id;
  const kicked = new Set<string>();
  const isPublic = options.isPublic ?? false;
  const shareCode = "TEST01";

  const content: ContentRecord<C> = {
    id: "content-1",
    authorId: hostId,
    authorName: hostId,
    title: options.title ?? def.displayName,
    isPublic: true,
    data: options.content,
    createdAt: new Date(),
  };

  const store: Store<S> = {
    status: "lobby",
    currentPlayerId: null,
    tokenOrder: [],
    completedAt: null,
    state: null,
    answers: [],
    deadline: null,
  };
  // Deadlines run on this clock, which only moves when a test says so.
  let now = Date.now();
  const timerSeconds = options.timerSeconds ?? null;
  if (timerSeconds !== null && !def.timer?.options.includes(timerSeconds)) {
    throw new Error(`${def.displayName} doesn't offer a ${timerSeconds}s timer`);
  }

  const broadcasts: RecordedBroadcast[] = [];
  const notifications: RecordedNotification[] = [];
  /** What the current action has sent so far; delivered on commit. */
  let pending: { broadcasts: RecordedBroadcast[]; notifications: RecordedNotification[] } | null = null;

  const viewerFor = (id: string | null): Viewer | null => {
    if (id === null) return null;
    const player = players.find((p) => p.id === id);
    return { id, username: player?.username ?? id, isGuest: false };
  };
  const roleFor = (id: string | null): ViewerRole | null =>
    id !== null && players.some((p) => p.id === id) ? "player" : isPublic ? "observer" : null;

  const stateApi: StateApi<S> = {
    async get() {
      return store.state ? clone(store.state) : null;
    },
    async init(data) {
      if (!store.state) store.state = { data: clone(data), version: 0 };
      return clone(store.state);
    },
    async update(data, { expectedVersion }) {
      if (!store.state || store.state.version !== expectedVersion) throw new StateConflictError();
      store.state = { data: clone(data), version: expectedVersion + 1 };
      return clone(store.state);
    },
    mutate(change, { attempts } = {}) {
      return mutateState<S>(stateApi, change, attempts);
    },
  };

  // Only the one row this session plays; enough for the session-side code of a game.
  const contentApi: ContentApi<C> = {
    async create() {
      throw new Error("The test harness doesn't support creating content from a session");
    },
    async get(id) {
      return id === content.id ? clone(content) : null;
    },
    async list() {
      return [clone(content)];
    },
    async update() {
      throw new Error("The test harness doesn't support updating content from a session");
    },
    async remove() {
      throw new Error("The test harness doesn't support removing content from a session");
    },
  };

  function contextFor(viewerId: string | null): SessionContext<C, S> {
    const viewer = viewerFor(viewerId);
    const session: SessionInfo<C> = {
      shareCode,
      status: store.status,
      hostId,
      isPublic,
      currentPlayerId: store.currentPlayerId,
      players: clone(players),
      tokenOrder: [...store.tokenOrder],
      currentTokenIndex: store.answers.length,
      completedAt: store.completedAt,
      timerSeconds,
      content: clone(content),
    };
    const send = (b: RecordedBroadcast) => (pending ? pending.broadcasts.push(b) : broadcasts.push(b));

    return {
      gameType: def.gameType,
      viewer,
      role: roleFor(viewerId),
      session,
      content: contentApi,
      state: stateApi,
      async answers(): Promise<GivenAnswer[]> {
        return store.answers.map((a) => ({ ...a, username: players.find((p) => p.id === a.playerId)?.username ?? null }));
      },
      deadline: {
        async set(inMs, key) {
          if (!Number.isFinite(inMs) || inMs < 0) throw new Error("deadline.set: inMs must be a non-negative number");
          if (!key) throw new Error("deadline.set: a key is required");
          store.deadline = { at: new Date(now + inMs), key };
          send({ name: "game:deadline", data: { at: store.deadline.at.toISOString(), key } });
          return clone(store.deadline);
        },
        async clear() {
          store.deadline = null;
          send({ name: "game:deadline", data: null });
        },
        async get() {
          return store.deadline ? clone(store.deadline) : null;
        },
      },
      turn: {
        async set(playerId) {
          if (!players.some((p) => p.id === playerId)) throw new GameError(400, "That player isn't in this game");
          store.currentPlayerId = playerId;
          session.currentPlayerId = playerId;
        },
      },
      async finish() {
        if (store.status !== "in_progress") return false;
        store.status = "completed";
        store.completedAt = new Date();
        session.status = "completed";
        session.completedAt = store.completedAt;
        return true;
      },
      async broadcast(name, data) {
        send({ name, data: clone(data) });
      },
      async notify(to, message) {
        const wanted = to === "others" ? players.map((p) => p.id).filter((id) => id !== viewer?.id) : [to].flat();
        const recipients = [...new Set(wanted)].filter((id) => players.some((p) => p.id === id));
        if (recipients.length === 0) return;
        const note = { to: recipients, ...message };
        if (pending) pending.notifications.push(note);
        else notifications.push(note);
      },
    };
  }

  /** Runs `fn` as one action: all or nothing, like runInTransaction. */
  async function transaction<T>(fn: () => Promise<T>): Promise<T> {
    const snapshot = clone(store);
    pending = { broadcasts: [], notifications: [] };
    const commit = () => {
      broadcasts.push(...pending!.broadcasts);
      notifications.push(...pending!.notifications);
    };
    try {
      const result = await fn();
      commit();
      return result;
    } catch (err) {
      if (err instanceof GameError) commit();
      else Object.assign(store, snapshot);
      throw err;
    } finally {
      pending = null;
    }
  }

  /** Like core: an overdue deadline is claimed (cleared) and fired before anything else. */
  async function fireDueDeadline(viewerId: string | null) {
    if (!def.onDeadline || store.status !== "in_progress" || !store.deadline || store.deadline.at.getTime() > now) return false;
    const { key } = store.deadline;
    await transaction(async () => {
      const ctx = contextFor(viewerId);
      await ctx.deadline.clear();
      await def.onDeadline!(ctx, key);
    }).catch((err) => {
      if (!(err instanceof GameError)) throw err;
    });
    return true;
  }

  /** Like lib/sessions/leave.ts: off the roster, host handed on, then the game's onPlayerLeft. */
  async function removePlayer(actorId: string, playerId: string, reason: "left" | "kicked") {
    if (store.status !== "lobby" && store.status !== "in_progress") throw new GameError(400, "This game is over");
    if (reason === "kicked") {
      if (actorId !== hostId) throw new GameError(403, "Only the host can remove players");
      if (playerId === actorId) throw new GameError(400, "To go yourself, leave the game");
    }
    if (store.status === "in_progress" && !def.onPlayerLeft) {
      throw new GameError(409, `${def.displayName} can't continue without a player`);
    }
    const index = players.findIndex((p) => p.id === playerId);
    if (index < 0) throw new GameError(404, "That player isn't in this game");

    const before = { players: clone(players), hostId, kicked: new Set(kicked) };
    const undo = () => {
      players.splice(0, players.length, ...before.players);
      hostId = before.hostId;
      kicked.clear();
      for (const id of before.kicked) kicked.add(id);
    };

    players.splice(index, 1);
    if (reason === "kicked") kicked.add(playerId);
    if (playerId === hostId && players.length > 0) hostId = players[0].id;
    if (store.status === "lobby") {
      if (players.length === 0) store.status = "expired";
      return;
    }
    const stored = clone(store);
    const sent = { broadcasts: broadcasts.length, notifications: notifications.length };
    try {
      await transaction(async () => {
        const ctx = contextFor(actorId);
        await def.onPlayerLeft!(ctx, { playerId, reason });
        if (ctx.session.players.length === 0) await ctx.finish();
      });
    } catch (err) {
      // A refusal from the game undoes the removal and its writes too (unlike an action's GameError).
      Object.assign(store, stored);
      broadcasts.length = sent.broadcasts;
      notifications.length = sent.notifications;
      undo();
      throw err;
    }
  }

  const refusal = (r: { status: number; error: string; extra?: Record<string, unknown> }) =>
    new GameError(r.status, r.error, r.extra);

  return {
    get hostId() {
      return hostId;
    },
    /** Players still in the game, in join order. */
    get playerIds() {
      return players.map((p) => p.id);
    },
    /** Removed by the host (and so barred from rejoining). */
    kicked: () => [...kicked],

    /** `playerId` leaves on their own. Rejects with the GameError core would answer with. */
    leave: (playerId: string) => removePlayer(playerId, playerId, "left"),
    /** The host removes `playerId`. */
    kick: (playerId: string, by: string = hostId) => removePlayer(by, playerId, "kicked"),
    /** Everything broadcast by committed actions, oldest first. */
    broadcasts,
    /** Every push notification sent by committed actions, oldest first. */
    notifications,

    /** The host starts the game. */
    async start({ randomize = false }: { randomize?: boolean } = {}) {
      if (store.status !== "lobby") throw new Error("Already started");
      if (players.length < def.minPlayers || players.length > def.maxPlayers) {
        throw new Error(`${def.displayName} takes ${def.minPlayers}–${def.maxPlayers} players, not ${players.length}`);
      }
      await transaction(async () => {
        store.status = "in_progress";
        const started = (await def.start(contextFor(hostId), { randomize })) ?? {};
        store.tokenOrder = started.tokenOrder ?? players.map((p) => `turn_${p.id}`);
        store.currentPlayerId = started.firstPlayerId ?? store.currentPlayerId ?? hostId;
      });
    },

    /** Acts as one player, or as `null` for a logged-out spectator. */
    as(viewerId: string | null) {
      return {
        /** Calls a session action. Rejects with the GameError the real route would answer with. */
        async act<T = unknown>(name: string, input?: unknown): Promise<T> {
          const action = Object.hasOwn(def.sessionActions ?? {}, name) ? def.sessionActions![name] : undefined;
          if (!action) throw new GameError(404, "Not found");
          await fireDueDeadline(viewerId);
          const ctx = contextFor(viewerId);
          const refused = checkSessionAccess(action, ctx, ctx.session);
          if (refused) throw refusal(refused);
          const parsed = parseInput(action, input ?? {});
          if (!parsed.ok) throw refusal(parsed.refusal);
          return transaction(async () => ((await action.handler(ctx, parsed.value)) ?? { ok: true }) as T);
        },
        /** What buildPlayProps sends this viewer's browser. */
        async playProps() {
          await fireDueDeadline(viewerId);
          return def.buildPlayProps(contextFor(viewerId));
        },
      };
    },

    /** Shared turn engine: records an answer for a token. */
    answer(playerId: string, tokenId: string, value: string) {
      store.answers.push({ tokenId, value, playerId });
    },

    /** Runs `fn` with the context `viewerId` would get, as one action. For testing hooks and helpers directly. */
    withContext<T>(viewerId: string | null, fn: (ctx: SessionContext<C, S>) => Promise<T>): Promise<T> {
      return transaction(() => fn(contextFor(viewerId)));
    },

    /** Overwrites the state as if another request had written it (the version moves on). */
    setState(data: S) {
      store.state = { data: clone(data), version: (store.state?.version ?? -1) + 1 };
    },

    /** The game's current state, or null before start. */
    state(): S | null {
      return store.state ? clone(store.state.data) : null;
    },
    status: () => store.status,
    currentPlayerId: () => store.currentPlayerId,
    /** The reveal's props. */
    async result() {
      await fireDueDeadline(hostId);
      return def.buildResult(contextFor(hostId));
    },

    /**
     * The deadline clock. `advance` moves it on and, like a browser's countdown
     * reaching zero, fires a due deadline; with `nudge: false` nobody is
     * watching, and it waits for the next action or page load.
     */
    clock: {
      now: () => new Date(now),
      async advance(ms: number, { nudge = true }: { nudge?: boolean } = {}) {
        now += ms;
        return nudge ? fireDueDeadline(null) : false;
      },
    },
    deadline: () => (store.deadline ? clone(store.deadline) : null),
  };
}

export type TestSession = ReturnType<typeof createTestSession<unknown, unknown>>;
