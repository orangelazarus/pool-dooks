"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShareCode } from "./ShareCode";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { useSession } from "@/hooks/useSession";
import type { Player } from "@/hooks/useGameState";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Bell, Crown, Eye, Globe, Lock, LogOut, Play, Users, X } from "lucide-react";
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
  isPublic: boolean;
  /** ISO time a public lobby closes if the game hasn't started; null if it never does. */
  expiresAt: string | null;
  /** The lobby was already full: this viewer isn't a player and will watch the game. */
  isSpectator: boolean;
}

export function Lobby({
  shareCode,
  currentUserId,
  hostId,
  initialPlayers,
  gameDisplayName,
  subtitle,
  minPlayers,
  isPublic,
  expiresAt,
  isSpectator,
}: LobbyProps) {
  const router = useRouter();
  const { status: pushStatus, subscribe } = usePushNotifications();
  const [starting, setStarting] = useState(false);
  const isHost = currentUserId === hostId;

  // Counts a public lobby down to its closing time. At zero the page is
  // reloaded, and the server (the only real timekeeper) shows it as expired.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    const closesAt = new Date(expiresAt).getTime();
    const tick = () => {
      const left = Math.ceil((closesAt - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, left));
      // A second's grace, so the server agrees the time is up.
      if (left <= -1) {
        clearInterval(id);
        router.refresh();
      }
    };
    const id = setInterval(tick, 1000);
    tick();
    return () => clearInterval(id);
  }, [expiresAt, router]);

  // The roster is the server's. Joins and leaves show at once, then ask the
  // server for the page again; whenever its roster arrives it replaces ours.
  // That also repairs one missed while the live channel was still joining,
  // since useSession refreshes the page once it has joined.
  const serverPlayers: Player[] = initialPlayers.map((p) => ({
    playerId: p.playerId,
    username: p.username ?? "Unknown",
    avatarUrl: p.avatarUrl ?? undefined,
  }));
  const serverKey = serverPlayers.map((p) => p.playerId).join(",");
  const [roster, setRoster] = useState({ key: serverKey, players: serverPlayers });
  if (roster.key !== serverKey) setRoster({ key: serverKey, players: serverPlayers });
  const players = roster.players;

  useSession(shareCode, (event) => {
    if (event.type === "session:started") {
      router.push(`/sessions/${shareCode}/play`);
    }
    if (event.type === "player:left" && event.payload.playerId === currentUserId) {
      if (event.payload.reason === "kicked") toast.error("The host removed you from this game");
      router.push("/home");
      return;
    }
    if (event.type === "player:joined") {
      const joined = event.payload;
      setRoster((r) => (r.players.some((p) => p.playerId === joined.playerId) ? r : { ...r, players: [...r.players, joined] }));
      router.refresh();
    }
    if (event.type === "player:left") {
      const { playerId } = event.payload;
      setRoster((r) => ({ ...r, players: r.players.filter((p) => p.playerId !== playerId) }));
      router.refresh();
    }
    // The new host gets the Start button.
    if (event.type === "host:changed") router.refresh();
  });

  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (playerId: string) => {
    const leaving = playerId === currentUserId;
    if (!window.confirm(leaving ? "Leave this game?" : "Remove this player? They won't be able to rejoin.")) return;
    setRemoving(playerId);
    try {
      const res = leaving
        ? await fetch(`/api/sessions/${shareCode}/leave`, { method: "POST" })
        : await fetch(`/api/sessions/${shareCode}/kick`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ playerId }),
          });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Something went wrong");
      if (leaving) router.push("/home");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setRemoving(null);
    }
  };

  const handleStart = async () => {
    setStarting(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/start`, { method: "POST" });
      if (res.status === 410) {
        toast.error("This game expired");
        router.refresh();
        return;
      }
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
        <Badge variant="outline" className="mt-2 gap-1 text-xs" data-visibility={isPublic ? "public" : "private"}>
          {isPublic ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
          {isPublic ? "Public — anyone can join or watch" : "Private — invite only"}
        </Badge>
        {secondsLeft !== null && (
          <p className={`text-xs mt-2 ${secondsLeft < 60 ? "text-destructive" : "text-muted-foreground"}`} data-expires-in={secondsLeft}>
            Closes in {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")} unless the game starts
          </p>
        )}
      </div>

      <div className="mb-8">
        <ShareCode code={shareCode} />
      </div>

      <div className="border rounded-lg p-4 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <Users className="h-4 w-4" />
          <span className="font-medium text-sm">Players ({players.length})</span>
        </div>
        <div className="space-y-2">
          {players.map((player) => (
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
              {isHost && player.playerId !== currentUserId && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  aria-label={`Remove ${player.username}`}
                  disabled={removing !== null}
                  onClick={() => remove(player.playerId)}
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
        </div>
        {players.length < minPlayers && (
          <p className="text-xs text-muted-foreground text-center mt-4">
            {minPlayers - players.length} more player{minPlayers - players.length === 1 ? "" : "s"} needed to start
          </p>
        )}
      </div>

      {isSpectator && (
        <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-sm" data-spectator>
          <Eye className="h-4 w-4 shrink-0 mt-0.5" />
          <p>The lobby is full — you&apos;ll watch when the game starts.</p>
        </div>
      )}

      {!isSpectator && pushStatus === "idle" && (
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
          disabled={starting || players.length < minPlayers}
          size="lg"
          className="w-full gap-2"
        >
          <Play className="h-5 w-5" />
          {starting ? "Starting..." : "Start Game"}
        </Button>
      )}

      {!isHost && !isSpectator && (
        <p className="text-center text-sm text-muted-foreground">
          Waiting for the host to start the game...
        </p>
      )}

      {!isSpectator && players.some((p) => p.playerId === currentUserId) && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full gap-2 mt-3 text-muted-foreground"
          disabled={removing !== null}
          onClick={() => remove(currentUserId)}
        >
          <LogOut className="h-4 w-4" />
          Leave game
        </Button>
      )}
    </div>
  );
}
