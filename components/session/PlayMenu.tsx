"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { LogOut, MoreHorizontal, UserX } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface PlayMenuProps {
  shareCode: string;
  currentUserId: string;
  hostId: string;
  players: Array<{ playerId: string; username: string }>;
}

/**
 * Leaving mid-game, and the host removing a player. Shown only for games
 * that can carry on without someone (onPlayerLeft). Leaving is final.
 */
export function PlayMenu({ shareCode, currentUserId, hostId, players }: PlayMenuProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const others = currentUserId === hostId ? players.filter((p) => p.playerId !== currentUserId) : [];

  const run = async (url: string, body: unknown, confirmText: string) => {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Something went wrong");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 pt-3 flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger
          disabled={busy}
          aria-label="Game options"
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          {others.map((p) => (
            <DropdownMenuItem
              key={p.playerId}
              className="gap-2 cursor-pointer"
              onClick={() =>
                run(`/api/sessions/${shareCode}/kick`, { playerId: p.playerId }, `Remove ${p.username} from the game? They can't rejoin.`)
              }
            >
              <UserX className="h-4 w-4" /> Remove {p.username}
            </DropdownMenuItem>
          ))}
          {others.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem
            className="gap-2 text-destructive cursor-pointer"
            onClick={() =>
              run(`/api/sessions/${shareCode}/leave`, null, "Leave this game? You can't rejoin it, but you can still watch if it's public.")
            }
          >
            <LogOut className="h-4 w-4" /> Leave game
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
