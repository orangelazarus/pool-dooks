"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShareCode } from "./ShareCode";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import { useGameState } from "@/hooks/useGameState";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Bell, Crown, Play, Users } from "lucide-react";
import { toast } from "sonner";

interface LobbyProps {
  shareCode: string;
  currentUserId: string;
  hostId: string;
  initialPlayers: Array<{
    playerId: string;
    username: string | null;
    avatarUrl: string | null;
  }>;
  gameDisplayName: string;
  subtitle: string;
  minPlayers: number;
}

export function Lobby({
  shareCode,
  currentUserId,
  hostId,
  initialPlayers,
  gameDisplayName,
  subtitle,
  minPlayers,
}: LobbyProps) {
  const router = useRouter();
  const { status: pushStatus, subscribe } = usePushNotifications();
  const [starting, setStarting] = useState(false);
  const isHost = currentUserId === hostId;

  const { state, handleEvent } = useGameState(
    initialPlayers.map((p) => ({
      playerId: p.playerId,
      username: p.username ?? "Unknown",
      avatarUrl: p.avatarUrl ?? undefined,
    }))
  );

  useSession(shareCode, (event) => {
    handleEvent(event);
    if (event.type === "session:started") {
      router.push(`/sessions/${shareCode}/play`);
    }
  });

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/start`, { method: "POST" });
      if (!res.ok) throw new Error();
      router.push(`/sessions/${shareCode}/play`);
    } catch {
      toast.error("Failed to start game");
      setStarting(false);
    }
  };

  const handleEnableNotifications = async () => {
    const ok = await subscribe();
    if (ok) toast.success("Notifications enabled!");
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold">{gameDisplayName}</h1>
        {subtitle && (
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        )}
      </div>

      <div className="mb-8">
        <ShareCode code={shareCode} />
      </div>

      <div className="border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4" />
          <span className="font-medium text-sm">Players ({state.players.length})</span>
        </div>
        <div className="space-y-2">
          {state.players.map((player) => (
            <div key={player.playerId} className="flex items-center gap-3">
              <Avatar className="h-8 w-8">
                <AvatarImage src={player.avatarUrl ?? undefined} />
                <AvatarFallback className="text-xs">
                  {player.username[0]?.toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <span className="text-sm font-medium flex-1">{player.username}</span>
              {player.playerId === hostId && (
                <Badge variant="secondary" className="gap-1 text-xs">
                  <Crown className="h-3 w-3" /> Host
                </Badge>
              )}
              {player.playerId === currentUserId && player.playerId !== hostId && (
                <Badge variant="outline" className="text-xs">You</Badge>
              )}
            </div>
          ))}
        </div>
        {state.players.length < minPlayers && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {minPlayers - state.players.length} more player{minPlayers - state.players.length === 1 ? "" : "s"} needed to start
          </p>
        )}
      </div>

      {pushStatus === "idle" && (
        <Button
          variant="outline"
          className="w-full gap-2 mb-3"
          onClick={handleEnableNotifications}
        >
          <Bell className="h-4 w-4" />
          Enable turn notifications
        </Button>
      )}

      {isHost && (
        <Button
          onClick={handleStart}
          disabled={starting || state.players.length < minPlayers}
          size="lg"
          className="w-full gap-2"
        >
          <Play className="h-5 w-5" />
          {starting ? "Starting..." : "Start Game"}
        </Button>
      )}

      {!isHost && (
        <p className="text-center text-sm text-muted-foreground">
          Waiting for the host to start the game...
        </p>
      )}
    </div>
  );
}
