"use client";
import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSessionChat } from "@/hooks/useSessionChat";
import { MAX_MESSAGE_LENGTH } from "@/lib/sessions/chat-types";
import { cn } from "@/lib/utils";

const readKey = (shareCode: string) => `chat-read:${shareCode}`;

// Where this browser has read up to. A convenience only: storage may be
// blocked, and then every message simply counts as unread until opened.
function loadLastRead(shareCode: string): string {
  try {
    return window.localStorage.getItem(readKey(shareCode)) ?? "";
  } catch {
    return "";
  }
}

function saveLastRead(shareCode: string, at: string) {
  try {
    window.localStorage.setItem(readKey(shareCode), at);
  } catch {}
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/**
 * The session's chat: a floating button with an unread count that opens the
 * conversation. Mounted once for the lobby, play and reveal pages. Renders
 * nothing for someone who may not see this session.
 */
export function SessionChat({ shareCode }: { shareCode: string }) {
  const { visible, messages, canPost, viewerId, send } = useSessionChat(shareCode);
  const [open, setOpen] = useState(false);
  const [lastRead, setLastRead] = useState(() => loadLastRead(shareCode));
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const latest = messages.at(-1)?.createdAt ?? "";

  // While the chat is open, everything in it has been read.
  useEffect(() => {
    if (!open || !latest) return;
    saveLastRead(shareCode, latest);
    endRef.current?.scrollIntoView({ block: "end" });
  }, [open, latest, shareCode]);

  if (!visible) return null;

  const unread = open ? 0 : messages.filter((m) => m.playerId !== viewerId && m.createdAt > lastRead).length;

  // Opening reads what is there; closing reads whatever arrived meanwhile.
  const toggle = (next: boolean) => {
    if (latest) setLastRead(latest);
    setOpen(next);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    const error = await send(body);
    setSending(false);
    if (error) toast.error(error);
    else setDraft("");
  };

  return (
    <>
      {!open && (
        <Button
          size="icon"
          className="fixed bottom-4 right-4 z-40 size-12 rounded-full shadow-lg"
          onClick={() => toggle(true)}
          aria-label={unread > 0 ? `Open chat, ${unread} unread` : "Open chat"}
          data-chat-button
        >
          <MessageCircle className="size-5" />
          {unread > 0 && (
            <span
              className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-xs font-semibold text-white"
              data-chat-unread
            >
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      )}

      <Sheet open={open} onOpenChange={toggle}>
        <SheetContent side="right" className="gap-0 data-[side=right]:w-full">
          <SheetHeader className="border-b">
            <SheetTitle>Chat</SheetTitle>
            <SheetDescription>
              {canPost ? "Everyone in this game can see what you write." : "You're watching — only players can write."}
            </SheetDescription>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3" data-chat-messages>
            {messages.length === 0 && (
              <p className="pt-8 text-center text-sm text-muted-foreground">No messages yet.</p>
            )}
            {messages.map((m) => {
              const mine = m.playerId !== null && m.playerId === viewerId;
              return (
                <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
                  <span className="mb-0.5 text-xs text-muted-foreground">
                    {mine ? "You" : m.username} · {timeOf(m.createdAt)}
                  </span>
                  <p
                    className={cn(
                      "max-w-[85%] rounded-2xl px-3 py-1.5 text-sm whitespace-pre-wrap break-words",
                      mine ? "bg-primary text-primary-foreground" : "bg-muted"
                    )}
                  >
                    {m.body}
                  </p>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {canPost && (
            <form onSubmit={submit} className="flex gap-2 border-t p-3">
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={MAX_MESSAGE_LENGTH}
                placeholder="Message"
                aria-label="Message"
                autoComplete="off"
              />
              <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
                <Send className="size-4" />
              </Button>
            </form>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
