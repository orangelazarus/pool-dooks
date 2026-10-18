"use client";
import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import type { SessionEvent } from "@/lib/realtime/events";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * Joins a private channel once Realtime has the viewer's token. Joined any
 * earlier, the first attempt goes out anonymous and is refused, and whatever
 * is sent before the retry a few seconds later is lost.
 */
export function subscribePrivately(supabase: SupabaseClient, channel: RealtimeChannel, isClosed: () => boolean) {
  supabase.realtime.setAuth().then(
    () => !isClosed() && channel.subscribe(),
    () => !isClosed() && channel.subscribe()
  );
}

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
      });
    let closed = false;
    subscribePrivately(supabase, channel, () => closed);

    channelRef.current = channel;

    return () => {
      closed = true;
      channel.unsubscribe();
    };
  }, [shareCode]);
}
