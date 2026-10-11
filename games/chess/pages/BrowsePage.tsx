"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crown, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { TIME_CONTROLS, timeControlLabel } from "../clock";
import type { HostColor } from "../engine";

interface ChessGame {
  id: string;
  title: string;
  hostColor: HostColor;
  timeControlSeconds: number | null;
}

const HOST_COLORS: { id: HostColor; label: string }[] = [
  { id: "white", label: "White" },
  { id: "black", label: "Black" },
  { id: "random", label: "Random" },
];
const UNTIMED = "untimed";

const colorLabel = (hostColor: HostColor) =>
  hostColor === "random" ? "Random colors" : `Host plays ${hostColor}`;

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<ChessGame[]>([]);
  const [title, setTitle] = useState("");
  const [hostColor, setHostColor] = useState<HostColor>("white");
  const [timeControlSeconds, setTimeControlSeconds] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/games/chess")
      .then((r) => r.json())
      .then(setGames)
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/games/chess", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, hostColor, timeControlSeconds }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : "Failed to create game");
      router.push(`/sessions/new?gameType=chess&gameContentId=${data.id}`);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Crown className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Chess</h1>
          <p className="text-muted-foreground text-sm">The classic two-player game</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>Pick your color and whether to play against the clock.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sunday chess"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <Label>You play</Label>
              <Select value={hostColor} onValueChange={(v) => v && setHostColor(v as HostColor)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {HOST_COLORS.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 space-y-1.5">
              <Label>Time per side</Label>
              <Select
                value={timeControlSeconds === null ? UNTIMED : String(timeControlSeconds)}
                onValueChange={(v) => v && setTimeControlSeconds(v === UNTIMED ? null : Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_CONTROLS.map((t) => (
                    <SelectItem key={t.label} value={t.seconds === null ? UNTIMED : String(t.seconds)}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>Two players. Tap a piece, then tap where it should go.</li>
            <li>
              {timeControlSeconds === null
                ? "Untimed: move whenever you like — you'll get a notification when it's your turn."
                : "Timed: clocks start after White's first move, and running out of time loses the game."}
            </li>
            <li>Either player can resign or offer a draw at any time.</li>
          </ul>

          <Button onClick={handleCreate} disabled={creating} className="w-full gap-2">
            <Gamepad2 className="h-4 w-4" />
            {creating ? "Creating..." : "Create & Start Session"}
          </Button>
        </CardContent>
      </Card>

      {games.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
            Recent Games
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {games.map((g) => (
              <Card key={g.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{g.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {colorLabel(g.hostColor)} · {timeControlLabel(g.timeControlSeconds)}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/sessions/new?gameType=chess&gameContentId=${g.id}`)}
                  >
                    Play
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
