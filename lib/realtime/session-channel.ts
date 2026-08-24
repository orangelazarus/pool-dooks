"use client";
import { createClient } from "@/lib/supabase/client";
import type { SessionEvent } from "./events";

export function createSessionChannel(shareCode: string) {
  const supabase = createClient();
  return supabase.channel(`session:${shareCode}`);
}

export function subscribeToSession(
  shareCode: string,
  onEvent: (event: SessionEvent) => void
) {
  const channel = createSessionChannel(shareCode);

  channel.on("broadcast", { event: "*" }, (payload) => {
    onEvent(payload.payload as SessionEvent);
  });

  channel.subscribe();
  return channel;
}
