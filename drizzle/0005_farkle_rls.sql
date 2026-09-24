-- Every public table is auto-exposed via Supabase's REST API. Without RLS,
-- anyone holding the public anon key can read/write these tables directly,
-- bypassing all turn-validation logic in games/farkle/plugin.ts. The app's
-- own DB role owns these tables (it ran the CREATE TABLE), so table-owner
-- RLS bypass means this does not affect the app's own server-side queries.

ALTER TABLE "farkle_games" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "farkle_turns" ENABLE ROW LEVEL SECURITY;

-- farkle_games: recent-games browse list is meant to be visible to any
-- signed-in player (same shape as sessions_select); only the author may
-- create their own row.
CREATE POLICY "farkle_games_select" ON "farkle_games" FOR SELECT TO authenticated USING (true);
CREATE POLICY "farkle_games_insert" ON "farkle_games" FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());

-- farkle_turns: no client ever queries this table directly — every read and
-- write goes through /api/games/farkle/<code>/{roll,keep,bank,state}, which
-- enforces "your turn" / session-membership checks server-side. No policy is
-- added for anon/authenticated, so the REST API default-denies both roles.
