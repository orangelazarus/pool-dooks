import type React from "react";
import type { NextRequest, NextResponse } from "next/server";
import type { Session } from "@/lib/db/schema";

export interface AnswerContext {
  session: Session;
  tokenId: string;
  value: string;
  nextTokenId: string | null;
  nextPlayerId: string | null;
}

/**
 * The shape the session engine consumes. Games do not implement this — they
 * call defineGame() from lib/game-sdk, which builds it and puts core's
 * authentication, access and input checks in front of every game handler.
 */
export interface GamePlugin {
  gameType: string;
  displayName: string;
  description: string;
  browsePath: string;
  minPlayers: number;
  maxPlayers: number;
  supportsRandomize: boolean;
  /** Timer choices to offer the host at session creation; null if the game isn't timed. */
  timer: { options: number[]; label: string } | null;
  /** The game sets deadlines (it defines onDeadline), so rendering it may move the session on. */
  usesDeadlines: boolean;
  /** A player can leave, or be removed, while the game is in progress. */
  supportsLeaving: boolean;

  /**
   * Called when host starts the game.
   * Returns the ordered array of turn IDs.
   */
  start(session: Session, randomize: boolean): Promise<{ tokenOrder: string[]; firstPlayerId?: string }>;

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
  buildResult(session: Session): Promise<Record<string, unknown>>;

  /**
   * Builds the game-specific props passed to PlayComponent.
   */
  buildPlayProps(session: Session): Promise<Record<string, unknown>>;

  /**
   * Optional subtitle shown in the lobby.
   */
  getLobbyMeta?(session: Session): Promise<{ subtitle: string }>;

  /**
   * Returns a human-readable title for a piece of game content that `viewerId`
   * may use: public, or their own. Throws otherwise, as for content that doesn't exist.
   */
  getContentMeta(gameContentId: string, viewerId: string | null): Promise<{ title: string }>;

  /**
   * Runs the game's onPlayerLeft, inside the caller's transaction, after the
   * player has been marked inactive. Only when supportsLeaving.
   */
  playerLeft(session: Session, playerId: string, reason: "left" | "kicked"): Promise<void>;

  /** The session's pending deadline, for the play page's `deadline` prop. */
  getDeadline(session: Session): Promise<{ at: string; key: string } | null>;

  /**
   * Serves /api/games/[gameType]/[...path]: runs the game's declared actions
   * behind core's checks.
   */
  handleRequest(req: NextRequest, path: string[]): Promise<NextResponse>;

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
