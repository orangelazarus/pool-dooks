-- One-time move of Pool Dooks' data from its own table (pool_dooks) into
-- core's generic game storage. Run once, right before deploying the SDK-based
-- plugin. Safe to re-run: existing rows are left alone. Ids are preserved so
-- sessions keep pointing at their content. The old table is not touched.
-- (This game has no per-session state: answers are in core's answers table.)

INSERT INTO game_content (id, game_type, author_id, title, is_public, data, created_at, updated_at)
SELECT
  id,
  'pool_dooks',
  author_id,
  title,
  coalesce(is_public, true),
  jsonb_build_object(
    'theme', theme,
    'bodyJson', body_json,
    'bodyText', body_text,
    'tokens', tokens,
    'aiGenerated', coalesce(ai_generated, false),
    'extraWeird', coalesce(extra_weird, false),
    'importSource', import_source
  ),
  coalesce(created_at, now()),
  coalesce(updated_at, created_at, now())
FROM pool_dooks
ON CONFLICT (id) DO NOTHING;

-- Sessions from before games were plugins point at their story through the
-- legacy pool_dook_id column only. Give them the content id core reads.
UPDATE sessions
SET game_content_id = pool_dook_id
WHERE game_content_id IS NULL
  AND pool_dook_id IS NOT NULL;
