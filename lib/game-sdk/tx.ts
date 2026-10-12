// One database transaction per game action.
//
// A game handler usually makes several writes — save the state, hand over the
// turn, end the game. Run on their own, a crash between two of them leaves the
// game half-updated. Inside runInTransaction they all commit together or not
// at all, and anything that tells the outside world (realtime, push) is held
// back until the commit has happened.
import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "@/lib/db";
import { GameError } from "./errors";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

interface Scope {
  tx: Transaction;
  afterCommit: Array<() => Promise<void>>;
}

const scope = new AsyncLocalStorage<Scope>();

/** The connection game-facing writes should use: the action's transaction if there is one. */
export const executor = (): Transaction | typeof db => scope.getStore()?.tx ?? db;

/**
 * Runs `effect` once the surrounding transaction has committed — or right
 * away when there isn't one. For realtime and push: nobody should be told
 * about a change that might still be rolled back.
 */
export async function afterCommit(effect: () => Promise<void>): Promise<void> {
  const current = scope.getStore();
  if (current) current.afterCommit.push(effect);
  else await effect();
}

/**
 * Runs `fn` in a transaction.
 *
 * - Returns normally → commit.
 * - Throws a GameError → commit, then rethrow. A GameError is a reply to the
 *   caller, not a failure: a handler may legitimately record something and
 *   then refuse (chess records a loss on time, then tells the player why
 *   their move wasn't accepted).
 * - Throws anything else → roll everything back, rethrow.
 */
export async function runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
  const effects: Scope["afterCommit"] = [];
  let reply: GameError | undefined;

  const result = await db.transaction(async (tx) =>
    scope.run({ tx, afterCommit: effects }, async () => {
      try {
        return await fn();
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        reply = err;
        return undefined as T;
      }
    })
  );

  // Committed. Delivery problems must not undo or fail the action.
  for (const effect of effects) await effect().catch(() => {});

  if (reply) throw reply;
  return result;
}
