import type React from "react";
import type { NextRequest, NextResponse } from "next/server";
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
   * Returns the ordered array of turn IDs.
   */
  start(
    session: Session,
    players: SessionPlayerInfo[],
    randomize: boolean
  ): Promise<{ tokenOrder: string[]; firstPlayerId?: string }>;

  /**
   * Called after an answer is recorded.
   *
   * `nextTokenLabel` names the next blank for the "your turn" push.
   *
   * `answered` describes the blank that was just filled. Return it ONLY if this
   * game's answers are public during play: when present, the answer is shown
   * to everyone in the session and sent in push notifications. Games with
   * secret answers (e.g. Guess the Number) must leave it out.
   */
  getAnswerHints(
    ctx: AnswerContext
  ): Promise<{ nextTokenLabel?: string; answered?: { label: string; type: string } }>;

  /**
   * Builds the result payload sent to the reveal screen.
   */
  buildResult(
    session: Session,
    answers: Answer[]
  ): Promise<Record<string, unknown>>;

  /**
   * Builds the game-specific props passed to PlayComponent.
   */
  buildPlayProps(
    session: Session,
    players: SessionPlayerInfo[]
  ): Promise<Record<string, unknown>>;

  /**
   * Optional subtitle shown in the lobby.
   */
  getLobbyMeta?(session: Session): Promise<{ subtitle: string }>;

  /**
   * Returns a human-readable title for a piece of game content.
   */
  getContentMeta(gameContentId: string): Promise<{ title: string }>;

  /**
   * Handles game-specific API requests routed to /api/games/[gameType]/[...path].
   * Implement this to own your content API endpoints.
   */
  handleRequest?(req: NextRequest, path: string[]): Promise<NextResponse>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  PlayComponent: React.ComponentType<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  RevealComponent: React.ComponentType<any>;

  /**
   * Page shown at /games/[gameType] — browse/discover content for this game.
   * Receives searchParams from the dynamic route.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  BrowsePage: React.ComponentType<any>;

  /**
   * Optional page shown at /games/[gameType]/create — create/edit content.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  CreatePage?: React.ComponentType<any>;

  /**
   * Optional page shown at /games/[gameType]/library — user's saved content.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  LibraryPage?: React.ComponentType<any>;
}
