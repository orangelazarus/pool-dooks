-- number_games was created (0002_number_game.sql) without RLS, so it's been
-- exposed via Supabase's public REST API since then — worse than the Farkle
-- tables, since number_games.secret_number is the answer players are
-- guessing. A row-level policy can't hide a single column, and no client
-- ever queries this table directly (only via /api/games/guess_the_number,
-- through the app's own DB role), so the correct fix is a full default-deny:
-- no SELECT/INSERT policy for anon/authenticated at all.

ALTER TABLE "number_games" ENABLE ROW LEVEL SECURITY;
