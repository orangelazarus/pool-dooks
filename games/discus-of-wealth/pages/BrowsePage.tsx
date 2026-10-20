"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Disc3, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { contentAction } from "@/lib/game-sdk/client";
import { BONUS_PRIZE, MIN_ROUND_WIN, VOWEL_COST } from "../board";
import { ROUND_OPTIONS } from "../schema";

interface DiscusGame {
  id: string;
  title: string;
  rounds: number;
  bonus: boolean;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<DiscusGame[]>([]);
  const [rounds, setRounds] = useState<number>(3);
  const [bonus, setBonus] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    contentAction<DiscusGame[]>("discus_of_wealth", "list", undefined, "GET")
      .then(setGames)
      .catch(() => {});
  }, []);

  const play = (id: string) => router.push(`/sessions/new?gameType=discus_of_wealth&gameContentId=${id}`);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await contentAction<{ id: string }>("discus_of_wealth", "create", { rounds, bonus });
      play(data.id);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Disc3 className="h-7 w-7 text-pool" />
        <div>
          <h1 className="text-2xl font-bold">Discus of Wealth</h1>
          <p className="text-muted-foreground text-sm">Spin, call letters, solve the puzzle</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>
            Take turns spinning the discus and calling consonants for money, buy vowels, and solve the puzzle to bank
            what you&apos;ve won. Puzzles come from thousands that aired on TV, plus some of our own.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Puzzles</Label>
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

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="bonus" className="cursor-pointer">
                Bonus round
              </Label>
              <p className="text-xs text-muted-foreground">
                The leader gets R S T L N E, picks three consonants and a vowel, and has 15 seconds to solve for{" "}
                {money(BONUS_PRIZE)}.
              </p>
            </div>
            <Switch id="bonus" checked={bonus} onCheckedChange={setBonus} />
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>Each consonant earns the wedge&apos;s value for every time it appears</li>
            <li>Vowels cost {money(VOWEL_COST)} of the round&apos;s money</li>
            <li>Bankrupt wipes your round money; Lose a Turn passes play</li>
            <li>Solve to bank your round money (at least {money(MIN_ROUND_WIN)})</li>
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
                    <p className="text-xs text-muted-foreground">
                      {g.rounds} puzzles{g.bonus ? " + bonus round" : ""}
                    </p>
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
