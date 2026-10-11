"use client";
// The browser-side surface of the game SDK: calling a game's declared actions
// and listening to its session. Games never build API URLs or open realtime
// channels themselves.
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import type { SessionEvent } from "@/lib/realtime/events";

export { useGameState } from "@/hooks/useGameState";
export type { Player, GameState } from "@/hooks/useGameState";
export type { SessionEvent } from "@/lib/realtime/events";

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
