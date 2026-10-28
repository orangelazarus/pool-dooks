"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Shuffle, Gamepad2, Users, Globe, Timer } from "lucide-react";

const OFF = "off";
const describeSeconds = (n: number) =>
  n % 60 === 0 ? `${n / 60} minute${n === 60 ? "" : "s"}` : n > 60 ? `${Math.floor(n / 60)}m ${n % 60}s` : `${n} seconds`;

export default function NewSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gameType = searchParams.get("gameType");
  const gameContentId = searchParams.get("gameContentId");
  const [joinCode, setJoinCode] = useState("");
  // "Play again" from a finished game carries its timer and turn order over.
  const [randomize, setRandomize] = useState(searchParams.get("randomize") === "1");
  const timerParam = searchParams.get("timer");
  const [isPublic, setIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [contentTitle, setContentTitle] = useState<string | null>(null);
  // The shuffle switch, worded by the game; null when it doesn't offer one.
  const [randomizeText, setRandomizeText] = useState<{ label: string; description: string } | null>(null);
  // Offered only by timed games; "off" until the host picks a time.
  const [timer, setTimer] = useState<{ options: number[]; label: string } | null>(null);
  const [timerChoice, setTimerChoice] = useState(OFF);
  const [rematchGroup, setRematchGroup] = useState<string[] | null>(null);

  // If the player opened a "play again" prompt before coming here to pick content,
  // their confirmed group is carried into whatever they create — say so up front.
  useEffect(() => {
    fetch("/api/sessions/pending-rematch")
      .then((r) => r.json())
      .then((d) => setRematchGroup(d.pending?.players ?? null))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (gameType && gameContentId) {
      fetch(`/api/game-content/meta?gameType=${encodeURIComponent(gameType)}&gameContentId=${encodeURIComponent(gameContentId)}`)
        .then((r) => r.json())
        .then((d) => {
          setContentTitle(d.title);
          setRandomizeText(d.randomize ?? null);
          setTimer(d.timer ?? null);
          if (timerParam && d.timer?.options.includes(Number(timerParam))) setTimerChoice(timerParam);
        })
        .catch(() => {});
    }
  }, [gameType, gameContentId, timerParam]);

  const handleCreate = async () => {
    if (!gameType || !gameContentId) { toast.error("No game selected"); return; }
    setCreating(true);
    try {
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gameType,
          gameContentId,
          randomizeOrder: randomize,
          isPublic,
          timerSeconds: timer && timerChoice !== OFF ? Number(timerChoice) : null,
        }),
      });
      if (!res.ok) throw new Error();
      const { shareCode } = await res.json();
      router.push(`/sessions/${shareCode}`);
    } catch {
      toast.error("Failed to create session");
      setCreating(false);
    }
  };

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    try {
      const res = await fetch(`/api/sessions/${code}/join`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Failed to join");
      }
      router.push(`/sessions/${code}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to join");
      setJoining(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <h1 className="text-2xl font-bold mb-8 text-center">Start or Join a Game</h1>

      {gameType && gameContentId && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gamepad2 className="h-5 w-5" />
              Create Session
            </CardTitle>
            <CardDescription>
              {contentTitle ? `"${contentTitle}"` : "Loading..."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rematchGroup && rematchGroup.length > 1 && (
              <div className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs">
                <Users className="h-4 w-4 shrink-0 mt-0.5" />
                <p>
                  Your group is coming along:{" "}
                  <span className="font-medium">{rematchGroup.join(", ")}</span>
                </p>
              </div>
            )}
            {randomizeText && (
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="randomize" className="cursor-pointer flex items-center gap-2">
                    <Shuffle className="h-4 w-4" />
                    {randomizeText.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">{randomizeText.description}</p>
                </div>
                <Switch id="randomize" checked={randomize} onCheckedChange={setRandomize} />
              </div>
            )}
            {timer && (
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label className="flex items-center gap-2">
                    <Timer className="h-4 w-4" />
                    {timer.label}
                  </Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {timerChoice === OFF ? "No clock: the game waits for everyone" : "When time runs out, the game moves on"}
                  </p>
                </div>
                <Select value={timerChoice} onValueChange={(v) => v && setTimerChoice(v)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={OFF}>Off</SelectItem>
                    {timer.options.map((n) => (
                      <SelectItem key={n} value={String(n)}>
                        {describeSeconds(n)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="public" className="cursor-pointer flex items-center gap-2">
                  <Globe className="h-4 w-4" />
                  Public game
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isPublic
                    ? "Listed on the home page: anyone can join, and anyone can watch once it starts. Closes if it hasn't started in 15 minutes"
                    : "Only people you share the code with can join"}
                </p>
              </div>
              <Switch id="public" checked={isPublic} onCheckedChange={setIsPublic} />
            </div>
            <Button onClick={handleCreate} disabled={creating} className="w-full">
              {creating ? "Creating..." : "Create Session"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Separator className="my-6" />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Join a Game</CardTitle>
          <CardDescription>Enter the 6-character share code from your host</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleJoin} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="code">Share Code</Label>
              <Input
                id="code"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))}
                placeholder="XK92PL"
                maxLength={6}
                className="font-mono text-lg tracking-widest text-center uppercase"
              />
            </div>
            <Button type="submit" disabled={joining || joinCode.length !== 6} className="w-full">
              {joining ? "Joining..." : "Join Game"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <p className="text-center text-sm text-muted-foreground mt-6">
        Looking for something to play?{" "}
        <Link href="/home" className="underline underline-offset-4">
          Browse the library
        </Link>
      </p>
    </div>
  );
}
