import { pgTable, uuid, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { profiles, sessions } from "@/lib/db/schema";

// Content row referenced by sessions.gameContentId — the settings the host
// picked at creation time.
export const farkleGames = pgTable("farkle_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  targetScore: integer("target_score").notNull().default(3000),
  // "original" | "kcd" — validated at the Zod layer in plugin.ts, plain text
  // column matches this codebase's no-Postgres-enum convention.
  ruleset: text("ruleset").notNull().default("original"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
export type FarkleGame = typeof farkleGames.$inferSelect;

// One row per session: the live, mutable turn state. Bypasses the shared
// tokenOrder/answers turn engine entirely since Farkle's roll/keep/bank loop
// doesn't fit a fixed one-answer-per-token model.
export const farkleTurns = pgTable("farkle_turns", {
  sessionId: uuid("session_id")
    .primaryKey()
    .references(() => sessions.id, { onDelete: "cascade" }),
  diceRolled: jsonb("dice_rolled").$type<number[] | null>(),
  diceRemaining: integer("dice_remaining").notNull().default(6),
  turnScore: integer("turn_score").notNull().default(0),
  rollsThisTurn: integer("rolls_this_turn").notNull().default(0),
  // Banked totals per playerId. Also doubles as the "has this player ever
  // banked" check (scores[id] ?? 0) > 0 for the Original ruleset's one-time
  // 500-point entry threshold.
  scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});
export type FarkleTurn = typeof farkleTurns.$inferSelect;
