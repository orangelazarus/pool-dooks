"use client";
import { useState, useCallback } from "react";
import type { SessionEvent } from "@/lib/realtime/events";

export interface Player {
  playerId: string;
  username: string;
  avatarUrl?: string | null;
}

export interface GameState {
  status: "lobby" | "in_progress" | "completed";
  players: Player[];
  tokenOrder: string[];
  currentTokenId: string | null;
  currentPlayerId: string | null;
  tokenIndex: number;
  total: number;
  answeredTokenIds: Set<string>;
}

const initialState: GameState = {
  status: "lobby",
  players: [],
  tokenOrder: [],
  currentTokenId: null,
  currentPlayerId: null,
  tokenIndex: 0,
  total: 0,
  answeredTokenIds: new Set(),
};

export function useGameState(
  initialPlayers: Player[] = [],
  initialOverride?: Partial<Omit<GameState, "players" | "answeredTokenIds">>
) {
  const [state, setState] = useState<GameState>({
    ...initialState,
    players: initialPlayers,
    ...(initialOverride ?? {}),
    status: "in_progress",
    answeredTokenIds: new Set(),
  });

  const handleEvent = useCallback((event: SessionEvent) => {
    setState((prev) => {
      switch (event.type) {
        case "player:joined":
          if (prev.players.find((p) => p.playerId === event.payload.playerId)) {
            return prev;
          }
          return {
            ...prev,
            players: [...prev.players, event.payload],
          };

        case "player:left":
          return {
            ...prev,
            players: prev.players.filter((p) => p.playerId !== event.payload.playerId),
          };

        case "session:started":
          return {
            ...prev,
            status: "in_progress",
            tokenOrder: event.payload.tokenOrder,
            currentTokenId: event.payload.tokenOrder[0] ?? null,
            currentPlayerId: event.payload.firstPlayerId,
            tokenIndex: 0,
            total: event.payload.tokenOrder.length,
          };

        case "turn:changed":
          return {
            ...prev,
            currentTokenId: event.payload.currentTokenId,
            currentPlayerId: event.payload.currentPlayerId,
            tokenIndex: event.payload.tokenIndex,
            total: event.payload.total,
          };

        case "answer:confirmed":
          return {
            ...prev,
            answeredTokenIds: new Set([...prev.answeredTokenIds, event.payload.tokenId]),
          };

        case "session:completed":
          return { ...prev, status: "completed" };

        default:
          return prev;
      }
    });
  }, []);

  return { state, handleEvent };
}
