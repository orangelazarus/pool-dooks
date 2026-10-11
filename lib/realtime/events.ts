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
  | {
      type: "farkle:state";
      payload: {
        currentPlayerId: string;
        dice: number[] | null;
        diceRemaining: number;
        turnScore: number;
        rollsThisTurn: number;
        scores: Record<string, number>;
        farkled: boolean;
        banked: boolean;
        hotDice: boolean;
        bankedAmount?: number;
      };
    }
  | {
      type: "chess:state";
      payload: {
        moves: string[];
        whitePlayerId: string;
        blackPlayerId: string;
        currentPlayerId: string;
        whiteMs: number | null;
        blackMs: number | null;
        turnStartedAt: number | null;
        serverNow: number;
        drawOfferedBy: string | null;
        result: "white" | "black" | "draw" | null;
        resultReason: string | null;
      };
    };
