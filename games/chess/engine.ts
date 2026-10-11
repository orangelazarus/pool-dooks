// Rules helpers on top of chess.js, shared by the server (authoritative move
// validation in plugin.ts) and the client (legal-move highlighting). No
// DB/React imports here.
import { Chess } from "chess.js";
import type { Side } from "./clock";

export type HostColor = Side | "random";
export type GameResult = Side | "draw";
export type ResultReason =
  | "checkmate"
  | "resignation"
  | "timeout"
  | "stalemate"
  | "agreement"
  | "repetition"
  | "fifty-move"
  | "insufficient-material";

// The full live state: returned by every route, broadcast as `chess:state`,
// and passed to ChessBoard as its initial props.
export interface ChessStatePayload {
  moves: string[];
  whitePlayerId: string;
  blackPlayerId: string;
  currentPlayerId: string;
  whiteMs: number | null;
  blackMs: number | null;
  turnStartedAt: number | null;
  // Server clock at send time, so clients can correct for their own clock skew.
  serverNow: number;
  drawOfferedBy: string | null;
  result: GameResult | null;
  resultReason: ResultReason | null;
}

export function otherSide(side: Side): Side {
  return side === "white" ? "black" : "white";
}

/**
 * Rebuild the game from its SAN move list. The position alone isn't enough —
 * threefold repetition needs the history.
 */
export function replay(moves: string[]): Chess {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  return chess;
}

export function sideToMove(chess: Chess): Side {
  return chess.turn() === "w" ? "white" : "black";
}

/** Has the position on the board ended the game? Null if play continues. */
export function detectEnd(chess: Chess): { result: GameResult; reason: ResultReason } | null {
  if (chess.isCheckmate()) return { result: otherSide(sideToMove(chess)), reason: "checkmate" };
  if (chess.isStalemate()) return { result: "draw", reason: "stalemate" };
  if (chess.isInsufficientMaterial()) return { result: "draw", reason: "insufficient-material" };
  if (chess.isThreefoldRepetition()) return { result: "draw", reason: "repetition" };
  if (chess.isDrawByFiftyMoves()) return { result: "draw", reason: "fifty-move" };
  return null;
}

export function resolveColors(
  hostColor: HostColor,
  hostId: string,
  guestId: string,
  random: () => number = Math.random
): { whitePlayerId: string; blackPlayerId: string } {
  const hostIsWhite = hostColor === "random" ? random() < 0.5 : hostColor === "white";
  return hostIsWhite
    ? { whitePlayerId: hostId, blackPlayerId: guestId }
    : { whitePlayerId: guestId, blackPlayerId: hostId };
}

const REASON_TEXT: Record<ResultReason, string> = {
  checkmate: "by checkmate",
  resignation: "by resignation",
  timeout: "on time",
  stalemate: "by stalemate",
  agreement: "by agreement",
  repetition: "by threefold repetition",
  "fifty-move": "by the fifty-move rule",
  "insufficient-material": "by insufficient material",
};

export function describeResult(
  result: GameResult,
  reason: ResultReason,
  names: { white: string; black: string }
): string {
  if (result === "draw") return `Draw ${REASON_TEXT[reason]}`;
  return `${names[result]} won ${REASON_TEXT[reason]}`;
}
