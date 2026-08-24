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
} from "drizzle-orm/pg-core";

// Extended user profiles (mirrors auth.users)
export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(),
  username: text("username").notNull().unique(),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// Mad lib themes
export const THEMES = [
  "everyday_life",
  "entertainment",
  "sports",
  "sci_fi",
  "fantasy",
  "food",
  "travel",
  "custom",
] as const;

export type Theme = (typeof THEMES)[number];

export const poolDooks = pgTable(
  "pool_dooks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorId: uuid("author_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    theme: text("theme").notNull(),
    bodyJson: jsonb("body_json").notNull(), // Tiptap ProseMirror doc
    bodyText: text("body_text").notNull(), // plain text with {{token_id}} markers
    tokens: jsonb("tokens").notNull(), // [{id, label, type, position, occurrence}]
    isPublic: boolean("is_public").default(true),
    aiGenerated: boolean("ai_generated").default(false),
    extraWeird: boolean("extra_weird").default(false),
    importSource: text("import_source"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_pool_dooks_theme").on(t.theme),
    index("idx_pool_dooks_author").on(t.authorId),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    shareCode: text("share_code").notNull().unique(),
    gameType: text("game_type").notNull().default("pool_dooks"),
    gameContentId: uuid("game_content_id"), // game-type-specific content reference (no FK)
    poolDookId: uuid("pool_dook_id") // legacy: kept for backward compat with old sessions
      .references(() => poolDooks.id, { onDelete: "restrict" }),
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("lobby"), // lobby | in_progress | completed
    randomizeOrder: boolean("randomize_order").default(false),
    tokenOrder: jsonb("token_order"), // resolved array of turn item IDs
    currentTokenIndex: integer("current_token_index").default(0),
    currentPlayerId: uuid("current_player_id").references(() => profiles.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
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
    isActive: boolean("is_active").default(true),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("unique_session_player").on(t.sessionId, t.playerId),
    index("idx_session_players_session").on(t.sessionId),
  ]
);

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

export const numberGames = pgTable("number_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  minNumber: integer("min_number").notNull().default(1),
  maxNumber: integer("max_number").notNull().default(100),
  secretNumber: integer("secret_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// TypeScript types derived from schema
export type Profile = typeof profiles.$inferSelect;
export type PoolDook = typeof poolDooks.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SessionPlayer = typeof sessionPlayers.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;

// Token shape stored in pool_dooks.tokens
export interface PoolDookToken {
  id: string;
  label: string; // display label, e.g. "noun", "silly adjective"
  type: string; // canonical type: noun|verb|adjective|adverb|place|name|number|custom
  position: number;
  occurrence: number; // disambiguates repeated types (noun #1, noun #2)
}
