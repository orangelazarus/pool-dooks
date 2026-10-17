-- Timed games. Apply in the Supabase SQL editor BEFORE deploying the code
-- that uses it: queries select every column the schema names.
--
-- timer_seconds: the host's timer choice when the game offers one (null = off).
-- deadline_at / deadline_key: the one pending deadline a game has set, if any.
-- A deadline is claimed by clearing it, so only one request ever fires it.
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS timer_seconds integer,
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS deadline_key text;
