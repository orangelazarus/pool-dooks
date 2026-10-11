import { pgTable, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { profiles, sessions } from "@/lib/db/schema";
import type { GameResult, HostColor, ResultReason } from "./engine";

// Content row referenced by sessions.gameContentId — the settings the host
// picked at creation time.
export const chessGames = pgTable("chess_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  // "white" | "black" | "random" — validated at the Zod layer in plugin.ts,
  // plain text column matches this codebase's no-Postgres-enum convention.
  hostColor: text("host_color").$type<HostColor>().notNull().default("white"),
  // Seconds per side; null means untimed.
  timeControlSeconds: integer("time_control_seconds"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export type ChessGame = typeof chessGames.$inferSelect;

// One row per session: the live, mutable game state. Like farkle_turns, this
// bypasses the shared tokenOrder/answers turn engine entirely.
export const chessStates = pgTable("chess_states", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  whitePlayerId: uuid("white_player_id").notNull().references(() => profiles.id),
  blackPlayerId: uuid("black_player_id").notNull().references(() => profiles.id),
  // Current position. Derivable from `moves`, but kept as the optimistic
  // concurrency guard for move writes.
  fen: text("fen").notNull(),
  // SAN move list — the source of truth the game is replayed from.
  moves: jsonb("moves").$type<string[]>().notNull().default([]),
  whiteMs: integer("white_ms"),
  blackMs: integer("black_ms"),
  turnStartedAt: timestamp("turn_started_at", { withTimezone: true }),
  drawOfferedBy: uuid("draw_offered_by").references(() => profiles.id),
  result: text("result").$type<GameResult>(),
  resultReason: text("result_reason").$type<ResultReason>(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
export type ChessState = typeof chessStates.$inferSelect;
