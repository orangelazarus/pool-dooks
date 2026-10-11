-- One-time move of Farkle's data from its own tables (farkle_games,
-- farkle_turns) into core's generic game storage. Run once, right before
-- deploying the SDK-based Farkle plugin. Safe to re-run: existing rows are
-- left alone. Ids are preserved so sessions keep pointing at their content.
-- The old tables are not touched.

INSERT INTO game_content (id, game_type, author_id, title, is_public, data, created_at, updated_at)
SELECT
  id,
  'farkle',
  author_id,
  title,
  true,
  jsonb_build_object('targetScore', target_score, 'ruleset', ruleset),
  coalesce(created_at, now()),
  coalesce(created_at, now())
FROM farkle_games
ON CONFLICT (id) DO NOTHING;

INSERT INTO game_state (session_id, game_type, data, version, updated_at)
SELECT
  session_id,
  'farkle',
  jsonb_build_object(
    'diceRolled', dice_rolled,
    'diceRemaining', dice_remaining,
    'turnScore', turn_score,
    'rollsThisTurn', rolls_this_turn,
    'scores', scores
  ),
  0,
  coalesce(updated_at, now())
FROM farkle_turns
ON CONFLICT (session_id) DO NOTHING;
