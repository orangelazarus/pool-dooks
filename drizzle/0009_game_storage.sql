-- Generic, core-owned storage for game plugins. Games read and write these
-- through lib/game-sdk only, scoped to their own game_type — so adding a game
-- never needs another migration.

-- A game's content/settings rows (what sessions.game_content_id points at).
CREATE TABLE "game_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_type" text NOT NULL,
	"author_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
	"title" text NOT NULL,
	"is_public" boolean NOT NULL DEFAULT true,
	"data" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_game_content_type_created" ON "game_content" ("game_type", "created_at" DESC);
--> statement-breakpoint
-- One row per session: the live, mutable game state. "version" is bumped on
-- every write and is the optimistic-concurrency guard.
CREATE TABLE "game_state" (
	"session_id" uuid PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
	"game_type" text NOT NULL,
	"data" jsonb NOT NULL,
	"version" integer NOT NULL DEFAULT 0,
	"updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Every public table is exposed through Supabase's REST API. No policy is
-- added for anon/authenticated, so both are default-denied: these tables are
-- reached only by the app server, whose role bypasses RLS.
ALTER TABLE "game_content" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "game_state" ENABLE ROW LEVEL SECURITY;
