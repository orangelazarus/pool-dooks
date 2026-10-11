-- One-time move of Chess's data from its own tables (chess_games,
-- chess_states) into core's generic game storage. Run once, right before
-- deploying the SDK-based Chess plugin. Safe to re-run: existing rows are
-- left alone. Ids are preserved so sessions keep pointing at their content.
-- The old tables are not touched.

INSERT INTO game_content (id, game_type, author_id, title, is_public, data, created_at, updated_at)
SELECT
  id,
  'chess',
  author_id,
  title,
  true,
  jsonb_build_object('hostColor', host_color, 'timeControlSeconds', time_control_seconds),
  coalesce(created_at, now()),
  coalesce(created_at, now())
FROM chess_games
ON CONFLICT (id) DO NOTHING;

INSERT INTO game_state (session_id, game_type, data, version, updated_at)
SELECT
  session_id,
  'chess',
  jsonb_build_object(
    'whitePlayerId', white_player_id,
    'blackPlayerId', black_player_id,
    'moves', moves,
    'whiteMs', white_ms,
    'blackMs', black_ms,
    'turnStartedAt', CASE WHEN turn_started_at IS NULL THEN NULL
                          ELSE (extract(epoch FROM turn_started_at) * 1000)::bigint END,
    'drawOfferedBy', draw_offered_by,
    'result', result,
    'resultReason', result_reason
  ),
  0,
  coalesce(updated_at, now())
FROM chess_states
ON CONFLICT (session_id) DO NOTHING;
