import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import { profiles } from "@/lib/db/schema";

export const numberGames = pgTable("number_games", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  minNumber: integer("min_number").notNull().default(1),
  maxNumber: integer("max_number").notNull().default(100),
  secretNumber: integer("secret_number").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type NumberGame = typeof numberGames.$inferSelect;
