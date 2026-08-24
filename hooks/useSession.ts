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
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!shareCode) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`session:${shareCode}`)
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
