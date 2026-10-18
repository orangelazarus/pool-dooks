"use client";
import { useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SessionEvent } from "@/lib/realtime/events";
import type { RealtimeChannel } from "@supabase/supabase-js";

export function useSession(
  shareCode: string | null,
  onEvent: (event: SessionEvent) => void
) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  // Keep the latest handler without resubscribing every render.
  const onEventRef = useRef(onEvent);
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!shareCode) return;

    const supabase = createClient();
    // Private: Realtime lets in only this session's players (anyone, if it's
    // public), and only the server can send, so events can be trusted.
    const channel = supabase
      .channel(`session:${shareCode}`, { config: { private: true } })
      .on("broadcast", { event: "*" }, (msg) => {
        onEventRef.current(msg.payload as SessionEvent);
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
    };
  }, [shareCode]);
}
