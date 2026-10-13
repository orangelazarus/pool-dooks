"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Gamepad2, VenetianMask } from "lucide-react";
import { toast } from "sonner";
import { contentAction } from "@/lib/game-sdk/client";
import { ROUND_OPTIONS } from "../schema";

interface SubterfugeGame {
  id: string;
  title: string;
  rounds: number;
}

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<SubterfugeGame[]>([]);
  const [rounds, setRounds] = useState<number>(8);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    contentAction<SubterfugeGame[]>("subterfuge", "list", undefined, "GET")
      .then(setGames)
      .catch(() => {});
  }, []);

  const play = (id: string) => router.push(`/sessions/new?gameType=subterfuge&gameContentId=${id}`);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await contentAction<{ id: string }>("subterfuge", "create", { rounds });
      play(data.id);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <VenetianMask className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Subterfuge</h1>
          <p className="text-muted-foreground text-sm">Fool your friends, find the truth</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>
            Every question has a blank. Everyone writes a lie to fill it, then tries to pick the real answer out of the
            lies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Questions</Label>
            <Select value={String(rounds)} onValueChange={(v) => v && setRounds(Number(v))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROUND_OPTIONS.map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    {n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>1000 points for picking the truth</li>
            <li>500 points for every player your lie fools</li>
            <li>The last question is worth double</li>
          </ul>

          <Button onClick={handleCreate} disabled={creating} className="w-full gap-2">
            <Gamepad2 className="h-4 w-4" />
            {creating ? "Creating..." : "Create & Start Session"}
          </Button>
        </CardContent>
      </Card>

      {games.length > 0 && (
        <div>
          <h2 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Recent Games</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {games.map((g) => (
              <Card key={g.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-sm">{g.title}</p>
                    <p className="text-xs text-muted-foreground">{g.rounds} questions</p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => play(g.id)}>
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
