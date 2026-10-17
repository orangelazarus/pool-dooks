-- Leaving and removing players. Apply in the Supabase SQL editor BEFORE
-- deploying the code that uses it: queries select every column the schema names.
--
-- A player who leaves (or is removed) keeps their row with is_active = false,
-- so their answers and join order stay attached. kicked marks a removal by
-- the host: those players may not rejoin. Leaving on your own is not kicked.
ALTER TABLE session_players
  ADD COLUMN IF NOT EXISTS kicked boolean NOT NULL DEFAULT false;
