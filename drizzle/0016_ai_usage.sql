-- AI usage, metered by core. Apply in the Supabase SQL editor BEFORE deploying
-- the code that uses it: queries select every column the schema names.
--
-- Games never call a model themselves: they ask core (ctx.ai), which checks
-- the budgets in lib/ai/limits.ts against this ledger before each call and
-- records the outcome after. Refusals are logged too, at most one per user,
-- reason and hour, so a script hammering a limit can't grow the table.
CREATE TABLE "ai_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now(),
	"user_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
	-- A salted hash: enough to group by address, without storing it.
	"ip_hash" text NOT NULL,
	"game_type" text NOT NULL,
	"use" text NOT NULL,
	"model" text,
	"input_tokens" integer NOT NULL DEFAULT 0,
	"output_tokens" integer NOT NULL DEFAULT 0,
	-- Estimated from tokens and lib/ai/models.ts; millionths of a dollar.
	"cost_micros" bigint NOT NULL DEFAULT 0,
	-- pending (in flight) | ok | error | refused:<reason>
	"outcome" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_created" ON "ai_usage" ("created_at");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_user_created" ON "ai_usage" ("user_id", "created_at");
--> statement-breakpoint
CREATE INDEX "idx_ai_usage_ip_created" ON "ai_usage" ("ip_hash", "created_at");
--> statement-breakpoint
-- Off switches, flipped by hand in the SQL editor; no deploy needed.
-- scope: 'all' | 'game:<gameType>' | 'user:<profile id>'. A row means off.
CREATE TABLE "ai_blocks" (
	"scope" text PRIMARY KEY NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
-- Reached only by the app server, whose role bypasses RLS (see 0015).
ALTER TABLE "ai_usage" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "ai_blocks" ENABLE ROW LEVEL SECURITY;
