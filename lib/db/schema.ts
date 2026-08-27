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
    gameType: text("game_type").notNull().default("pool_dooks"),
    gameContentId: uuid("game_content_id"),
    poolDookId: uuid("pool_dook_id"), // legacy: no FK — pool_dooks table is game-owned
    hostId: uuid("host_id")
      .notNull()
      .references(() => profiles.id),
    status: text("status").notNull().default("lobby"), // lobby | in_progress | completed
    randomizeOrder: boolean("randomize_order").default(false),
    tokenOrder: jsonb("token_order"),
    currentTokenIndex: integer("current_token_index").default(0),
    currentPlayerId: uuid("current_player_id").references(() => profiles.id),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rematch: jsonb("rematch").$type<Rematch>(),
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

// TypeScript types derived from schema
export type Profile = typeof profiles.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type SessionPlayer = typeof sessionPlayers.$inferSelect;
export type Answer = typeof answers.$inferSelect;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
