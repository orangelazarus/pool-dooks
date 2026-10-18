// The only way the server tells browsers about a session. Channels are private:
// the policies in drizzle/0014_private_realtime.sql let only a session's players
// (or anyone, for a public game) listen, and nobody but the server send, so a
// browser can trust that what arrives here really came from us.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let admin: SupabaseClient | null = null;

/** Service role: the only key Realtime lets send on these channels. Never reaches a browser. */
function realtime(): SupabaseClient {
  admin ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

async function send(topic: string, event: string, payload: Record<string, unknown>): Promise<void> {
  const client = realtime();
  const channel = client.channel(topic, { config: { private: true } });
  try {
    await channel.httpSend(event, payload);
  } catch (err) {
    // Delivery is best effort: a browser that misses one catches up on its next fetch.
    console.error(`[realtime] ${topic} ${event}:`, err instanceof Error ? err.message : err);
  } finally {
    await client.removeChannel(channel);
  }
}

/** A session event (lib/realtime/events.ts) to everyone with the session open. */
export function sendSessionEvent(shareCode: string, event: string, payload: unknown): Promise<void> {
  return send(`session:${shareCode}`, event, { type: event, payload });
}

/** Tells a session's chat there is something new. Carries no text; browsers fetch it. */
export function sendChatPing(shareCode: string): Promise<void> {
  return send(`chat:${shareCode}`, "chat:message", {});
}
