"use client";
// The browser-side surface of the game SDK: calling a game's declared actions
// and listening to its session. Games never build API URLs or open realtime
// channels themselves.
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import type { SessionEvent } from "@/lib/realtime/events";

export { useGameState } from "@/hooks/useGameState";
export type { Player, GameState } from "@/hooks/useGameState";
export type { SessionEvent } from "@/lib/realtime/events";
export { shuffle, pickOne, pickSome } from "./shared";
export { Standings, type StandingsRow } from "./components/Standings";

/** A rejected action. `data` is the server's JSON, which may carry extra fields a game attached. */
export class GameActionError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly data: Record<string, unknown>
  ) {
    super(message);
    this.name = "GameActionError";
  }
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function call<T>(url: string, input: unknown, method: Method): Promise<T> {
  let target = url;
  const init: RequestInit = { method };
  if (method === "GET") {
    if (input && typeof input === "object") {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(input)) {
        if (value !== undefined && value !== null) query.set(key, String(value));
      }
      if ([...query].length > 0) target += `?${query}`;
    }
  } else if (input !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(input);
  }

  const res = await fetch(target, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new GameActionError(res.status, typeof data.error === "string" ? data.error : "Something went wrong", data);
  }
  return data as T;
}

/** Calls one of the game's `sessionActions`. Rejects with GameActionError. */
export function gameAction<T = unknown>(
  gameType: string,
  shareCode: string,
  action: string,
  input?: unknown,
  method: Method = "POST"
): Promise<T> {
  return call<T>(`/api/games/${gameType}/sessions/${shareCode}/${action}`, input, method);
}

/** Calls one of the game's `contentActions`. Rejects with GameActionError. */
export function contentAction<T = unknown>(
  gameType: string,
  action: string,
  input?: unknown,
  method: Method = "POST"
): Promise<T> {
  return call<T>(`/api/games/${gameType}/content/${action}`, input, method);
}

/** Shared turn engine: submit the current player's answer for a token. */
export function submitAnswer(shareCode: string, tokenId: string, value: string) {
  return call<{ ok: true; isComplete: boolean }>(`/api/sessions/${shareCode}/answer`, { tokenId, value }, "POST");
}

interface GameSessionHandlers {
  /** A message the game's server sent with ctx.broadcast(name, data). */
  onEvent?: (name: string, data: unknown) => void;
  /** Every session event, including the shared turn engine's (turn:changed, answer:confirmed…). */
  onSessionEvent?: (event: SessionEvent) => void;
  /** Default true: go to the reveal page when the game ends. */
  redirectOnComplete?: boolean;
}

/** Subscribes this component to its session's live updates. */
export function useGameSession(shareCode: string, handlers: GameSessionHandlers = {}) {
  const router = useRouter();
  // Keep the latest handlers without resubscribing every render.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useSession(shareCode, (event) => {
    const current = handlersRef.current;
    if (event.type === "game:deadline") {
      for (const listener of deadlineListeners.get(shareCode) ?? []) listener(event.payload);
    }
    current.onSessionEvent?.(event);
    if (event.type === "game:event") current.onEvent?.(event.payload.name, event.payload.data);
    if (
      (event.type === "session:completed" || event.type === "session:revealed") &&
      current.redirectOnComplete !== false
    ) {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });
}

interface GameViewOptions {
  /** The GET session action that returns this viewer's view. Default "state". */
  stateAction?: string;
  /** Broadcast names that mean "something changed, fetch the view again". Default ["changed"]. */
  refreshOn?: string[];
}

/**
 * The play-screen loop for a game whose server builds a per-viewer view:
 * holds the view, fetches it again when the game broadcasts a change or the
 * page comes back from the background, and runs actions. A reply to an action
 * is the new view; one carrying `finished: true` sends the player to the reveal.
 */
export function useGameView<V>(gameType: string, shareCode: string, initialView: V, options: GameViewOptions = {}) {
  const { stateAction = "state", refreshOn = ["changed"] } = options;
  const router = useRouter();
  const [view, setView] = useState(initialView);
  const [busy, setBusy] = useState(false);
  // Replies can arrive out of order; only the latest request may set the view.
  const latest = useRef(0);
  const refreshOnRef = useRef(refreshOn);
  useEffect(() => {
    refreshOnRef.current = refreshOn;
  });

  const request = useCallback(
    async (action: string, input?: unknown, method: Method = "POST") => {
      const mine = ++latest.current;
      const next = await gameAction<V & { finished?: boolean }>(gameType, shareCode, action, input, method);
      if (mine === latest.current) setView(next);
      return next;
    },
    [gameType, shareCode]
  );

  const refresh = useCallback(() => {
    request(stateAction, undefined, "GET").catch(() => {});
  }, [request, stateAction]);

  // The broadcast only says that something changed; what this viewer may see
  // of it comes from the server.
  useGameSession(shareCode, {
    onEvent: (name) => {
      if (refreshOnRef.current.includes(name)) refresh();
    },
  });

  // A phone that was asleep missed the broadcasts.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  /** Runs a session action. Resolves true if it succeeded; a refusal is shown as a toast. */
  const act = useCallback(
    async (action: string, input?: unknown) => {
      setBusy(true);
      try {
        const next = await request(action, input);
        if (next && typeof next === "object" && next.finished) router.push(`/sessions/${shareCode}/reveal`);
        return true;
      } catch (e) {
        toast.error(e instanceof GameActionError ? e.message : "Something went wrong");
        // 409: someone else's action landed first.
        if (e instanceof GameActionError && e.status === 409) refresh();
        return false;
      } finally {
        setBusy(false);
      }
    },
    [request, refresh, router, shareCode]
  );

  return { view, setView, act, busy, refresh };
}

// ── Timed games ─────────────────────────────────────────────────────────────

/** A pending deadline as the browser gets it: `at` is an ISO timestamp. */
export interface DeadlineInfo {
  at: string;
  key: string;
}

// useGameSession hands deadline events to useDeadline through this, so a page
// still has one realtime subscription however many hooks want its events.
const deadlineListeners = new Map<string, Set<(deadline: DeadlineInfo | null) => void>>();

const TICK_MS = 250;
// Ask a little after zero, so a slightly fast clock doesn't ask too early.
const NUDGE_GRACE_MS = 150;

/**
 * Counts down to the session's deadline. `initial` is the `deadline` prop core
 * passes every PlayComponent. When the countdown reaches zero this asks the
 * server to settle it; the game's own broadcast then brings the new phase.
 * Needs useGameSession (or useGameView) mounted on the same page.
 */
export function useDeadline(gameType: string, shareCode: string, initial: DeadlineInfo | null) {
  const [deadline, setDeadline] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  // Server time minus this browser's time, learned from the server's replies.
  const [skew, setSkew] = useState(0);
  const nudged = useRef<string | null>(null);
  // Bumped to ask again after the server said "not yet".
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const listeners = deadlineListeners.get(shareCode) ?? new Set();
    deadlineListeners.set(shareCode, listeners);
    listeners.add(setDeadline);
    return () => {
      listeners.delete(setDeadline);
      if (listeners.size === 0) deadlineListeners.delete(shareCode);
    };
  }, [shareCode]);

  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, [deadline]);

  const at = deadline ? Date.parse(deadline.at) : null;
  const remainingMs = at === null ? null : Math.max(0, at - (now + skew));

  useEffect(() => {
    if (!deadline || remainingMs === null || remainingMs > 0) return;
    const marker = `${deadline.at}|${deadline.key}`;
    if (nudged.current === marker) return;
    nudged.current = marker;
    const timer = setTimeout(() => {
      call<{ fired: boolean; deadline: DeadlineInfo | null; serverNow: string }>(
        `/api/games/${gameType}/sessions/${shareCode}/_deadline`,
        undefined,
        "POST"
      )
        .then((reply) => {
          setSkew(Date.parse(reply.serverNow) - Date.now());
          setDeadline(reply.deadline);
          // Asked too early (this clock runs fast): ask again once the server's clock gets there.
          if (!reply.fired && reply.deadline?.at === deadline.at) {
            const wait = Math.max(TICK_MS, Date.parse(reply.deadline.at) - Date.parse(reply.serverNow));
            setTimeout(() => {
              nudged.current = null;
              setRetry((n) => n + 1);
            }, wait + NUDGE_GRACE_MS);
          }
        })
        .catch(() => {
          nudged.current = null;
        });
    }, NUDGE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [deadline, remainingMs, retry, gameType, shareCode]);

  return { deadline, remainingMs, seconds: remainingMs === null ? null : Math.ceil(remainingMs / 1000) };
}
