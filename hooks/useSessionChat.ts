"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribePrivately } from "@/hooks/useSession";
import type { ChatMessage } from "@/lib/sessions/chat-types";

interface ChatState {
  // hidden — this viewer may not see the chat (or it hasn't loaded yet)
  visible: boolean;
  messages: ChatMessage[];
  canPost: boolean;
  viewerId: string | null;
}

const HIDDEN: ChatState = { visible: false, messages: [], canPost: false, viewerId: null };

/** Adds `incoming` to `current`, dropping repeats, oldest first. */
function merge(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  if (incoming.length === 0) return current;
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** A session's chat: its history, live updates, and sending. */
export function useSessionChat(shareCode: string) {
  const [state, setState] = useState<ChatState>(HIDDEN);
  const latestRef = useRef<string | null>(null);
  // The viewer's standing changes as they move through the session's pages —
  // a guest joins from the lobby, say — so each navigation asks again.
  const pathname = usePathname();

  const load = useCallback(
    async (onlyNew: boolean) => {
      const after = onlyNew ? latestRef.current : null;
      const res = await fetch(`/api/sessions/${shareCode}/chat${after ? `?after=${encodeURIComponent(after)}` : ""}`).catch(
        () => null
      );
      if (!res) return;
      if (!res.ok) {
        if (res.status === 403 || res.status === 404) setState(HIDDEN);
        return;
      }
      const data: { messages: ChatMessage[]; canPost: boolean; viewerId: string | null } = await res.json();
      setState((prev) => {
        const messages = merge(prev.messages, data.messages);
        latestRef.current = messages.at(-1)?.createdAt ?? null;
        return { visible: true, messages, canPost: data.canPost, viewerId: data.viewerId };
      });
    },
    [shareCode]
  );

  useEffect(() => {
    load(latestRef.current !== null);
  }, [load, pathname]);

  useEffect(() => {
    // The broadcast carries no text, only word that there is something new.
    // Private, like the session channel: only the server can send on it.
    const supabase = createClient();
    const channel = supabase
      .channel(`chat:${shareCode}`, { config: { private: true } })
      .on("broadcast", { event: "chat:message" }, () => load(true));
    let closed = false;
    // Messages posted while the join was under way only arrive by asking.
    subscribePrivately(supabase, channel, () => closed, (joined) => joined && load(true));
    // A phone that was asleep missed the broadcasts.
    const onVisible = () => {
      if (document.visibilityState === "visible") load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      channel.unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [shareCode, load]);

  /** Resolves to an error message, or null when the message was sent. */
  const send = useCallback(
    async (body: string): Promise<string | null> => {
      const res = await fetch(`/api/sessions/${shareCode}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }).catch(() => null);
      const data = await res?.json().catch(() => null);
      if (!res?.ok || !data?.message) return typeof data?.error === "string" ? data.error : "Couldn't send that";
      setState((prev) => {
        const messages = merge(prev.messages, [data.message]);
        latestRef.current = messages.at(-1)?.createdAt ?? null;
        return { ...prev, messages };
      });
      return null;
    },
    [shareCode]
  );

  return { ...state, send };
}
