import type React from "react";
import type { z } from "zod";

// ── What core tells a game about people and sessions ────────────────────────

export interface Viewer {
  id: string;
  username: string;
  /** An anonymous guest account rather than a signed-up one. */
  isGuest: boolean;
}

export interface SessionPlayer {
  id: string;
  username: string;
  avatarUrl: string | null;
  joinOrder: number;
}

// player — on the roster · observer — watching a public game · none — neither
export type ViewerRole = "player" | "observer";

export interface ContentRecord<C> {
  id: string;
  authorId: string | null;
  authorName: string | null;
  title: string;
  isPublic: boolean;
  data: C;
  createdAt: Date;
}

export interface SessionInfo<C> {
  shareCode: string;
  status: "lobby" | "in_progress" | "completed" | "expired";
  hostId: string;
  isPublic: boolean;
  /** Whose turn it is, or null before the game starts. */
  currentPlayerId: string | null;
  /** Active players in join order. */
  players: SessionPlayer[];
  /** Shared turn engine only: the ordered token ids, and how far play has got. */
  tokenOrder: string[];
  currentTokenIndex: number;
  completedAt: Date | null;
  /** The content row this session is playing. */
  content: ContentRecord<C>;
}

export interface GivenAnswer {
  tokenId: string;
  value: string;
  playerId: string | null;
  username: string | null;
}

// ── The APIs a handler is given ─────────────────────────────────────────────

export interface ContentListOptions {
  /** Only the viewer's own content (empty when logged out). Otherwise: public rows plus the viewer's own. */
  mine?: boolean;
  /** Case-insensitive match on the title. */
  search?: string;
  /** Exact-match filters on top-level fields of `data`. */
  where?: Record<string, string | number | boolean>;
  /** Default 50, capped at 100. */
  limit?: number;
}

/** A game's own content rows. Every call is confined to that game's type. */
export interface ContentApi<C> {
  /** The viewer becomes the author; requires a signed-in viewer. */
  create(input: { title: string; data: C; isPublic?: boolean }): Promise<ContentRecord<C>>;
  get(id: string): Promise<ContentRecord<C> | null>;
  list(options?: ContentListOptions): Promise<ContentRecord<C>[]>;
  /** Author only. */
  update(id: string, patch: { title?: string; data?: C; isPublic?: boolean }): Promise<ContentRecord<C>>;
  /** Author only. */
  remove(id: string): Promise<void>;
}

/** This session's live state. */
export interface StateApi<S> {
  get(): Promise<{ data: S; version: number } | null>;
  /** Creates the state if the session has none yet; returns whatever is stored afterwards. */
  init(data: S): Promise<{ data: S; version: number }>;
  /**
   * Replaces the state, but only if it is still at `expectedVersion`. Otherwise
   * throws StateConflictError (→ 409), so a double-submitted action can't apply twice.
   */
  update(data: S, options: { expectedVersion: number }): Promise<{ data: S; version: number }>;
}

export interface PushMessage {
  title: string;
  body: string;
}

/** Context for anything that happens outside a session: browsing and managing content. */
export interface ContentContext<C> {
  gameType: string;
  viewer: Viewer | null;
  content: ContentApi<C>;
}

/** Context for anything that happens inside one session of this game. */
export interface SessionContext<C, S> extends ContentContext<C> {
  session: SessionInfo<C>;
  /** The viewer's standing in this session; null if they have none (lifecycle hooks only). */
  role: ViewerRole | null;
  state: StateApi<S>;
  /** Turn-engine answers given so far. */
  answers(): Promise<GivenAnswer[]>;
  turn: {
    /** Hands the turn to one of this session's players. */
    set(playerId: string): Promise<void>;
  };
  /**
   * Ends the game: marks the session completed and sends everyone to the
   * reveal. Returns false if it had already ended.
   */
  finish(): Promise<boolean>;
  /** Realtime message to everyone with this session open. */
  broadcast(name: string, data: unknown): Promise<void>;
  /**
   * Push notification to players of this session — "others" is everyone but
   * the viewer. Ids that aren't players here are ignored; the link is set by core.
   */
  notify(to: "others" | string | string[], message: PushMessage): Promise<void>;
}

// ── How a game declares its API ─────────────────────────────────────────────

type Method = "GET" | "POST" | "PUT" | "DELETE";

interface ActionBase<I> {
  /** Default POST. For GET the input is read from the query string, so use z.coerce for numbers. */
  method?: Method;
  /** Validated before the handler runs; the handler receives the parsed value. */
  input?: z.ZodType<I>;
}

export interface ContentAction<C, I = unknown> extends ActionBase<I> {
  /**
   * public  — anyone, logged in or not
   * user    — any signed-in viewer, guests included
   * account — a signed-up account; use for anything costly or abusable
   */
  auth: "public" | "user" | "account";
  handler(ctx: ContentContext<C>, input: I): Promise<unknown>;
}

export interface SessionAction<C, S, I = unknown> extends ActionBase<I> {
  /**
   * player — only this session's players
   * viewer — players, plus observers when the session is public
   */
  access: "player" | "viewer";
  /** Session status the action needs. Default: "in_progress" for player actions, "any" for viewer actions. */
  when?: "in_progress" | "any";
  handler(ctx: SessionContext<C, S>, input: I): Promise<unknown>;
}

export interface GameDefinition<C = unknown, S = unknown> {
  /** Stable id, used in URLs and storage. Lowercase letters, digits and underscores. */
  gameType: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  supportsRandomize?: boolean;

  /**
   * Called when the host starts the game. Games on the shared turn engine
   * return a tokenOrder; games that run their own state usually call
   * ctx.state.init() and return who goes first.
   */
  start(
    ctx: SessionContext<C, S>,
    options: { randomize: boolean }
  ): Promise<{ tokenOrder?: string[]; firstPlayerId?: string } | void>;

  /** Props for PlayComponent. Everything returned is sent to the browser — players and observers alike. */
  buildPlayProps(ctx: SessionContext<C, S>): Promise<Record<string, unknown>>;
  /** Props for RevealComponent. */
  buildResult(ctx: SessionContext<C, S>): Promise<Record<string, unknown>>;
  getLobbyMeta?(ctx: SessionContext<C, S>): Promise<{ subtitle: string }>;

  /**
   * Shared turn engine only, called after each answer. Return `answered` ONLY
   * if this game's answers are public during play.
   */
  getAnswerHints?(
    ctx: SessionContext<C, S>,
    answer: { tokenId: string; value: string; nextTokenId: string | null; nextPlayerId: string | null }
  ): Promise<{ nextTokenLabel?: string; answered?: { label: string; type: string } }>;

  /** → /api/games/<gameType>/content/<name> */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  contentActions?: Record<string, ContentAction<C, any>>;
  /** → /api/games/<gameType>/sessions/<shareCode>/<name> */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sessionActions?: Record<string, SessionAction<C, S, any>>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PlayComponent: React.ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RevealComponent: React.ComponentType<any>;
  /** Page at /games/<gameType>. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BrowsePage: React.ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CreatePage?: React.ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LibraryPage?: React.ComponentType<any>;
}
