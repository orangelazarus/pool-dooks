export type SessionEvent =
  | { type: "player:joined"; payload: { playerId: string; username: string; avatarUrl?: string } }
  | { type: "player:left"; payload: { playerId: string } }
  | { type: "session:started"; payload: { tokenOrder: string[]; firstPlayerId: string } }
  | { type: "turn:changed"; payload: { currentTokenId: string; currentPlayerId: string; tokenIndex: number; total: number } }
  | {
      type: "answer:confirmed";
      payload: {
        tokenId: string;
        playerId: string;
        // Present only for games whose answers are public during play.
        answer?: { username: string; value: string; label: string; tokenType: string };
      };
    }
  | { type: "session:completed"; payload: { completedAt: string } }
  | { type: "session:revealed"; payload: Record<string, never> }
  | { type: "rematch:proposed"; payload: { proposedBy: string; proposedByUsername: string } }
  | { type: "rematch:responded"; payload: { playerId: string; username: string; accepted: boolean } }
  | { type: "rematch:ready"; payload: { shareCode: string } }
  // Everything a game built on lib/game-sdk broadcasts. Core doesn't know or
  // care what `name` and `data` mean — that is between a game's server and client.
  | { type: "game:event"; payload: { name: string; data: unknown } }
  // Timed games: the session's pending deadline changed (null: none pending).
  | { type: "game:deadline"; payload: { at: string; key: string } | null };
