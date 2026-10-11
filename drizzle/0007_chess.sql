CREATE TABLE "chess_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
	"title" text NOT NULL,
	"host_color" text NOT NULL DEFAULT 'white',
	"time_control_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "chess_states" (
	"session_id" uuid PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
	"white_player_id" uuid NOT NULL REFERENCES "profiles"("id"),
	"black_player_id" uuid NOT NULL REFERENCES "profiles"("id"),
	"fen" text NOT NULL,
	"moves" jsonb NOT NULL DEFAULT '[]'::jsonb,
	"white_ms" integer,
	"black_ms" integer,
	"turn_started_at" timestamp with time zone,
	"draw_offered_by" uuid REFERENCES "profiles"("id"),
	"result" text,
	"result_reason" text,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
-- Every public table is auto-exposed via Supabase's REST API, so lock these
-- down the same way as the Farkle tables (see 0005_farkle_rls.sql). The app's
-- own DB role bypasses RLS, so this does not affect server-side queries.
ALTER TABLE "chess_games" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "chess_states" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- chess_games: the recent-games browse list is visible to any signed-in
-- player; only the author may create their own row.
CREATE POLICY "chess_games_select" ON "chess_games" FOR SELECT TO authenticated USING (true);
--> statement-breakpoint
CREATE POLICY "chess_games_insert" ON "chess_games" FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

-- chess_states: no client ever queries this table directly — every read and
-- write goes through /api/games/chess/<code>/{move,resign,draw,flag,state}.
-- No policy is added for anon/authenticated, so the REST API default-denies both.
