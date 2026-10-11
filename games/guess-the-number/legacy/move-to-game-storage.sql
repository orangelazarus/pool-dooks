-- One-time move of Guess the Number's data from its own table (number_games)
-- into core's generic game storage. Run once, right before deploying the
-- SDK-based plugin. Safe to re-run: existing rows are left alone. Ids are
-- preserved so sessions keep pointing at their content. The old table is not
-- touched. (This game has no per-session state: guesses are in core's answers.)

INSERT INTO game_content (id, game_type, author_id, title, is_public, data, created_at, updated_at)
SELECT
  id,
  'guess_the_number',
  author_id,
  title,
  true,
  jsonb_build_object('minNumber', min_number, 'maxNumber', max_number, 'secretNumber', secret_number),
  coalesce(created_at, now()),
  coalesce(created_at, now())
FROM number_games
ON CONFLICT (id) DO NOTHING;
