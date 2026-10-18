"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { SessionEvent } from "@/lib/realtime/events";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";

/**
 * Joins a private channel once Realtime has the viewer's token. Joined any
 * earlier, the first attempt goes out anonymous and is refused, and whatever
 * is sent before the retry a few seconds later is lost.
 *
 * `onSettled` runs each time the join is decided: `true` once in (again, after
 * a reconnect), `false` when refused. Realtime keeps retrying a refused join.
 */
export function subscribePrivately(
  supabase: SupabaseClient,
  channel: RealtimeChannel,
  isClosed: () => boolean,
  onSettled?: (joined: boolean) => void
) {
  const subscribe = () => {
    if (isClosed()) return;
    channel.subscribe((status) => {
      if (isClosed()) return;
      if (status === "SUBSCRIBED") onSettled?.(true);
      if (status === "CHANNEL_ERROR") onSettled?.(false);
    });
  };
  supabase.realtime.setAuth().then(subscribe, subscribe);
}

export function useSession(
  shareCode: string | null,
  onEvent: (event: SessionEvent) => void
) {
  const router = useRouter();
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
    // Events sent while the join was under way never arrive, so once it is
    // decided, ask the server for the page as it is now: a lobby that started
    // in the meantime moves on to play. A refused join usually means the
    // viewer was just removed; the server's page then says so. Refused joins
    // keep retrying, so only the first of a run refreshes.
    let refusedSinceJoin = false;
    subscribePrivately(supabase, channel, () => closed, (joined) => {
      if (!joined && refusedSinceJoin) return;
      refusedSinceJoin = !joined;
      router.refresh();
    });

    channelRef.current = channel;

    return () => {
      closed = true;
      channel.unsubscribe();
    };
  }, [shareCode, router]);
}
