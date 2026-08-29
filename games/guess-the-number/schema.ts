import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { profiles } from "@/lib/db/schema";

/**
 * Which end of the spread the reveal celebrates: the closest guess wins, or the
 * furthest guess loses. Stored on the game rather than the session because it's
 * a rule of the game, like the range.
 */
export const SCORE_MODES = ["closest", "furthest"] as const;
export type ScoreMode = (typeof SCORE_MODES)[number];

export const SCORE_MODE_LABELS: Record<ScoreMode, string> = {
  closest: "Closest guess wins",
  furthest: "Furthest guess loses",
};

export const numberGames = pgTable("number_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  minNumber: integer("min_number").notNull().default(1),
  maxNumber: integer("max_number").notNull().default(100),
  secretNumber: integer("secret_number").notNull(),
  scoreMode: text("score_mode").$type<ScoreMode>().notNull().default("closest"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type NumberGame = typeof numberGames.$inferSelect;
