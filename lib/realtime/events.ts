export type SessionEvent =
  | { type: "player:joined"; payload: { playerId: string; username: string; avatarUrl?: string } }
  | { type: "player:left"; payload: { playerId: string } }
  | { type: "session:started"; payload: { tokenOrder: string[]; firstPlayerId: string } }
  | { type: "turn:changed"; payload: { currentTokenId: string; currentPlayerId: string; tokenIndex: number; total: number } }
  | { type: "answer:confirmed"; payload: { tokenId: string; playerId: string } }
  | { type: "session:completed"; payload: { completedAt: string } }
  | { type: "session:revealed"; payload: Record<string, never> }
  | { type: "rematch:proposed"; payload: { proposedBy: string; proposedByUsername: string } }
  | { type: "rematch:responded"; payload: { playerId: string; username: string; accepted: boolean } }
  | { type: "rematch:ready"; payload: { shareCode: string } };
