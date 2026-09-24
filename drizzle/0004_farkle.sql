CREATE TABLE "farkle_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
	"title" text NOT NULL,
	"target_score" integer NOT NULL DEFAULT 3000,
	"ruleset" text NOT NULL DEFAULT 'original',
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "farkle_turns" (
	"session_id" uuid PRIMARY KEY REFERENCES "sessions"("id") ON DELETE CASCADE,
	"dice_rolled" jsonb,
	"dice_remaining" integer NOT NULL DEFAULT 6,
	"turn_score" integer NOT NULL DEFAULT 0,
	"rolls_this_turn" integer NOT NULL DEFAULT 0,
	"scores" jsonb NOT NULL DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
