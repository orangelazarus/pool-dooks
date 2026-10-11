/**
 * Throw from a game handler to answer the request with a specific status.
 * Anything else a handler throws is logged and returned as a generic 500, so
 * internal details never reach the client.
 */
export class GameError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    /** Extra JSON merged into the error response, e.g. the authoritative state. */
    public readonly extra?: Record<string, unknown>
  ) {
    super(message);
    this.name = "GameError";
  }
}

/** The session's state changed since it was read — another request got there first. */
export class StateConflictError extends GameError {
  constructor() {
    super(409, "The game moved on — try again");
    this.name = "StateConflictError";
  }
}
