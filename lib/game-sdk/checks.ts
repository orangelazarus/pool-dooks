// The rules core applies before any game handler runs: who may call an
// action, when, and with what input. Pure, so the HTTP path (define.ts) and
// the test harness (testing.ts) enforce exactly the same thing.
import type { ContentAction, SessionAction, SessionInfo, Viewer, ViewerRole } from "./types";

export interface Refusal {
  status: number;
  error: string;
  extra?: Record<string, unknown>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function checkContentAuth(action: ContentAction<any, any>, viewer: Viewer | null): Refusal | null {
  if (action.auth !== "public" && !viewer) return { status: 401, error: "Unauthorized" };
  if (action.auth === "account" && viewer!.isGuest) return { status: 403, error: "Create an account to do this" };
  return null;
}

export function checkSessionAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: SessionAction<any, any, any>,
  who: { viewer: Viewer | null; role: ViewerRole | null },
  session: Pick<SessionInfo<unknown>, "hostId" | "status">
): Refusal | null {
  if (action.access === "player" || action.access === "host") {
    if (!who.viewer) return { status: 401, error: "Unauthorized" };
    if (who.role !== "player") return { status: 403, error: "Not a player in this game" };
    if (action.access === "host" && who.viewer.id !== session.hostId) {
      return { status: 403, error: "Only the host can do that" };
    }
  } else if (!who.role) {
    return { status: 403, error: "This game is private" };
  }

  const when = action.when ?? (action.access === "viewer" ? "any" : "in_progress");
  if (when === "in_progress" && session.status !== "in_progress") return { status: 400, error: "Session not in progress" };
  return null;
}

/** Validates raw input (a parsed JSON body, or query-string pairs for GET) against the action's schema. */
export function parseInput(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: ContentAction<any, any> | SessionAction<any, any, any>,
  raw: unknown
): { ok: true; value: unknown } | { ok: false; refusal: Refusal } {
  if (!action.input) return { ok: true, value: undefined };
  const parsed = action.input.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, refusal: { status: 400, error: "Invalid input", extra: { details: parsed.error.flatten() } } };
  }
  return { ok: true, value: parsed.data };
}
