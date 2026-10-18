-- Close Supabase's REST API (PostgREST) on the app's tables. Apply in the
-- Supabase SQL editor; safe before or after deploying, since the app never uses
-- these roles: the server reaches every table through Drizzle as its own role
-- (DATABASE_URL), and browsers only talk to Auth and Realtime.
--
-- Until now the browser roles had full privileges on every public table (from
-- Supabase's default privileges), and the policies from the old SETUP.md let
-- any signed-in user, guests included, with the public anon key:
--   * read every session, roster and profile, private games included
--   * add themselves to any session's players, even one they were removed from
--   * mark their own removed row active again
--   * insert answers into any session
--
-- Now: no privileges and no policies for anon or authenticated. RLS stays on,
-- so even a grant added by mistake later exposes nothing without a policy.
-- Realtime is untouched: its access check is the SECURITY DEFINER function
-- public.can_listen_to_session from 0014, which keeps its EXECUTE grant.

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- Tables created later (migrations run as postgres, which owns them all) stop
-- being exposed by default. The app's own role has direct grants and BYPASSRLS,
-- and isn't a member of anon or authenticated, so none of this touches it.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- The policies that granted those powers. service_role bypasses RLS anyway.
DROP POLICY IF EXISTS answers_insert ON answers;
DROP POLICY IF EXISTS answers_select ON answers;
DROP POLICY IF EXISTS answers_service ON answers;
DROP POLICY IF EXISTS profiles_insert ON profiles;
DROP POLICY IF EXISTS profiles_select ON profiles;
DROP POLICY IF EXISTS profiles_update ON profiles;
DROP POLICY IF EXISTS profiles_service ON profiles;
DROP POLICY IF EXISTS push_subs ON push_subscriptions;
DROP POLICY IF EXISTS push_subs_service ON push_subscriptions;
DROP POLICY IF EXISTS sp_insert ON session_players;
DROP POLICY IF EXISTS sp_select ON session_players;
DROP POLICY IF EXISTS sp_update ON session_players;
DROP POLICY IF EXISTS sp_service ON session_players;
DROP POLICY IF EXISTS sessions_insert ON sessions;
DROP POLICY IF EXISTS sessions_select ON sessions;
DROP POLICY IF EXISTS sessions_update ON sessions;
DROP POLICY IF EXISTS sessions_service ON sessions;

-- RLS on everywhere (session_messages and the game tables already are).
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_content ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_messages ENABLE ROW LEVEL SECURITY;
