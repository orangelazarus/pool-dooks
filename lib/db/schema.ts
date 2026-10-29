import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  bigint,
} from "drizzle-orm/pg-core";

// Extended user profiles (mirrors auth.users)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

/**
 * A pending "play again" proposal on a completed session. Any player may open
 * one; every player then confirms whether they want to carry on with the same
 * group. Confirmed players are seeded into the next session — nobody is blocked
 * waiting on players who decline or never answer.
 */
export interface Rematch {
  proposedBy: string;
  proposedAt: string;
  accepted: string[];
  declined: string[];
  /** Share code of the next session, set once the proposer has picked content. */
  newSessionCode: string | null;
}

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareCode: text("share_code").notNull().unique(),
    gameType: text("game_type").notNull(),
    gameContentId: uuid("game_content_id"),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("lobby"), // lobby | in_progress | completed | expired
    randomizeOrder: boolean("randomize_order").default(false),
    // Public sessions are listed on the home page: open to join while in the
    // lobby, open to watch once started.
    isPublic: boolean("is_public").notNull().default(false),
    tokenOrder: jsonb("token_order"),
    currentTokenIndex: integer("current_token_index").default(0),
    currentPlayerId: uuid("current_player_id").references(() => profiles.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rematch: jsonb("rematch").$type<Rematch>(),
    // Timed games: the host's timer choice (null = off), and the one pending
    // deadline the game has set. See lib/game-sdk (ctx.deadline).
    timerSeconds: integer("timer_seconds"),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    deadlineKey: text("deadline_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("idx_sessions_share_code").on(t.shareCode)]
);

export const sessionPlayers = pgTable(
  "session_players",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    joinOrder: integer("join_order").notNull(),
    // False once the player leaves or is removed; the row stays.
    isActive: boolean("is_active").default(true),
    // Removed by the host, so they may not rejoin. See lib/sessions/leave.ts.
    kicked: boolean("kicked").notNull().default(false),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_session_player").on(t.sessionId, t.playerId),
    index("idx_session_players_session").on(t.sessionId),
  ]
);

// Generic storage for game plugins, reached only through lib/game-sdk and
// always scoped to one gameType. See drizzle/0009_game_storage.sql.
export const gameContent = pgTable(
  "game_content",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    gameType: text("game_type").notNull(),
    authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    isPublic: boolean("is_public").notNull().default(true),
    data: jsonb("data").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_game_content_type_created").on(t.gameType, t.createdAt.desc())]
);

export const gameState = pgTable("game_state", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  gameType: text("game_type").notNull(),
  data: jsonb("data").notNull(),
  // Bumped on every write; the optimistic-concurrency guard.
  version: integer("version").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const answers = pgTable(
  "answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").references(() => profiles.id),
    tokenId: text("token_id").notNull(),
    value: text("value").notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_session_token").on(t.sessionId, t.tokenId),
    index("idx_answers_session").on(t.sessionId),
  ]
);

// One chat per session, from the lobby through to the reveal. Players write;
// spectators of a public session may read. See drizzle/0011_session_chat.sql.
export const sessionMessages = pgTable(
  "session_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    playerId: uuid("player_id").references(() => profiles.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_session_messages_session").on(t.sessionId, t.createdAt)]
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [uniqueIndex("unique_user_endpoint").on(t.userId, t.endpoint)]
);

// Every model call games make through ctx.ai, and every refusal. Core checks
// its budgets against this ledger. See drizzle/0016_ai_usage.sql.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => profiles.id, { onDelete: "set null" }),
    ipHash: text("ip_hash").notNull(),
    gameType: text("game_type").notNull(),
    use: text("use").notNull(),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costMicros: bigint("cost_micros", { mode: "number" }).notNull().default(0),
    outcome: text("outcome").notNull(),
  },
  (t) => [
    index("idx_ai_usage_created").on(t.createdAt),
    index("idx_ai_usage_user_created").on(t.userId, t.createdAt),
    index("idx_ai_usage_ip_created").on(t.ipHash, t.createdAt),
  ]
);

// AI off switches: 'all', 'game:<gameType>' or 'user:<profile id>'. A row means off.
export const aiBlocks = pgTable("ai_blocks", {
  scope: text("scope").primaryKey(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// TypeScript types derived from schema
export type Profile = typeof profiles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SessionPlayer = typeof sessionPlayers.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type SessionMessage = typeof sessionMessages.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
