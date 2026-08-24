import type React from "react";
import type { Session, Answer } from "@/lib/db/schema";

export interface SessionPlayerInfo {
  playerId: string;
  username: string;
  avatarUrl?: string | null;
  joinOrder: number;
}

export interface AnswerContext {
  session: Session;
  players: SessionPlayerInfo[];
  tokenId: string;
  value: string;
  nextTokenId: string | null;
  nextPlayerId: string | null;
}

export interface GamePlugin {
  gameType: string;
  displayName: string;
  description: string;
  browsePath: string;
  minPlayers: number;
  maxPlayers: number;
  supportsRandomize: boolean;

  /**
   * Called when host starts the game.
   * Returns the ordered array of turn IDs (e.g. token IDs for Pool Dooks).
   */
  start(
    session: Session,
    players: SessionPlayerInfo[],
    randomize: boolean
  ): Promise<{ tokenOrder: string[]; firstPlayerId?: string }>;

  /**
   * Called after an answer is recorded to get the label for push notifications.
   */
  getAnswerHints(ctx: AnswerContext): Promise<{ nextTokenLabel?: string }>;

  /**
   * Builds the result payload sent to the reveal screen.
   */
  buildResult(
    session: Session,
    answers: Answer[]
  ): Promise<Record<string, unknown>>;

  /**
   * Builds the game-specific props passed to PlayComponent.
   * Common props (shareCode, currentUserId, hostId, players) are added by the page.
   */
  buildPlayProps(
    session: Session,
    players: SessionPlayerInfo[]
  ): Promise<Record<string, unknown>>;

  /**
   * Optional subtitle shown in the lobby (e.g. "12 blanks to fill").
   */
  getLobbyMeta?(session: Session): Promise<{ subtitle: string }>;

  /**
   * Returns a human-readable title for a piece of game content.
   * Used by the session creation UI to show what's being played.
   */
  getContentMeta(gameContentId: string): Promise<{ title: string }>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PlayComponent: React.ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RevealComponent: React.ComponentType<any>;
}
