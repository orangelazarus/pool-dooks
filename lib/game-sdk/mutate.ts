// ctx.state.mutate, written once over get/update so the real context and the
// test harness retry in exactly the same way.
import { GameError, StateConflictError } from "./errors";
import type { StateApi } from "./types";

// Everyone acting at once can collide a few times in a row; past this, give up with the 409.
const DEFAULT_ATTEMPTS = 5;

export async function mutateState<S>(
  api: Pick<StateApi<S>, "get" | "update">,
  change: (data: S) => S,
  attempts = DEFAULT_ATTEMPTS
): Promise<{ data: S; version: number; changed: boolean }> {
  for (let attempt = 1; ; attempt++) {
    const stored = await api.get();
    if (!stored) throw new GameError(500, "Game state missing");
    const next = change(stored.data);
    if (next === stored.data) return { ...stored, changed: false };
    try {
      return { ...(await api.update(next, { expectedVersion: stored.version })), changed: true };
    } catch (err) {
      if (err instanceof StateConflictError && attempt < attempts) continue;
      throw err;
    }
  }
}
