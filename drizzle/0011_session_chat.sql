-- One chat per session, from the lobby through to the reveal. Players write;
-- spectators of a public session may read. Rows go when the session does.
CREATE TABLE "session_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL REFERENCES "sessions"("id") ON DELETE CASCADE,
	"player_id" uuid REFERENCES "profiles"("id") ON DELETE SET NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "idx_session_messages_session" ON "session_messages" ("session_id", "created_at");
--> statement-breakpoint
-- Every public table is exposed through Supabase's REST API. No policy is
-- added for anon/authenticated, so both are default-denied: chat is reached
-- only by the app server, whose role bypasses RLS.
ALTER TABLE "session_messages" ENABLE ROW LEVEL SECURITY;
