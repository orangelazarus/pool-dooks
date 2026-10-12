-- Drops the six tables games used to own. Since 0009 and the move to
-- lib/game-sdk, every game keeps its data in game_content and game_state;
-- these tables were copied there (games/*/legacy/move-to-game-storage.sql)
-- and nothing reads them any more.
--
-- No CASCADE on purpose: if anything unexpected still depends on one of these
-- tables, the statement fails instead of silently dropping it too.

-- The only thing pointing at them: sessions.pool_dook_id -> pool_dooks, a
-- foreign key left from before games were plugins. The column itself stays.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_mad_lib_id_mad_libs_id_fk";
--> statement-breakpoint
DROP TABLE "chess_states";
--> statement-breakpoint
DROP TABLE "chess_games";
--> statement-breakpoint
DROP TABLE "farkle_turns";
--> statement-breakpoint
DROP TABLE "farkle_games";
--> statement-breakpoint
DROP TABLE "number_games";
--> statement-breakpoint
DROP TABLE "pool_dooks";
