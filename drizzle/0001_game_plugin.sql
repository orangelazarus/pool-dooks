ALTER TABLE "sessions"
  ADD COLUMN "game_type" text NOT NULL DEFAULT 'pool_dooks',
  ADD COLUMN "game_content_id" uuid;
