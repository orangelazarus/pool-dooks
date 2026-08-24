import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { profiles } from "@/lib/db/schema";

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
    bodyJson: jsonb("body_json").notNull(),
    bodyText: text("body_text").notNull(),
    tokens: jsonb("tokens").notNull(),
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

export type PoolDook = typeof poolDooks.$inferSelect;

export interface PoolDookToken {
  id: string;
  label: string;
  type: string;
  position: number;
  occurrence: number;
}
