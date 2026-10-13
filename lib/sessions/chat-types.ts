// The parts of chat that browsers need too. Kept apart from ./chat, which
// reaches the database and so can't be bundled for the client.

export const MAX_MESSAGE_LENGTH = 500;

/** A message as a browser sees it. */
export interface ChatMessage {
  id: string;
  /** Null if the author's account has since been deleted. */
  playerId: string | null;
  username: string;
  body: string;
  createdAt: string;
}
