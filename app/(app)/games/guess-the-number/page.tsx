"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Gamepad2, Hash } from "lucide-react";
import { toast } from "sonner";

interface NumberGame {
  id: string;
  title: string;
  minNumber: number;
  maxNumber: number;
}

export default function GuessTheNumberPage() {
  const router = useRouter();
  const [games, setGames] = useState<NumberGame[]>([]);
  const [min, setMin] = useState("1");
  const [max, setMax] = useState("100");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/number-games")
      .then((r) => r.json())
      .then(setGames)
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    const minNum = parseInt(min, 10);
    const maxNum = parseInt(max, 10);
    if (isNaN(minNum) || isNaN(maxNum) || minNum >= maxNum) {
      toast.error("Min must be less than max");
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/number-games", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ min: minNum, max: maxNum }),
      });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      router.push(`/sessions/new?gameType=guess_the_number&gameContentId=${id}`);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Hash className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Guess the Number</h1>
          <p className="text-muted-foreground text-sm">Everyone guesses — closest wins</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>Set the range. The secret number is hidden until the reveal.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="min">Min</Label>
              <Input
                id="min"
                type="number"
                value={min}
                onChange={(e) => setMin(e.target.value)}
                className="font-mono"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="max">Max</Label>
              <Input
                id="max"
                type="number"
                value={max}
                onChange={(e) => setMax(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
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
                    <p className="text-xs text-muted-foreground">{g.minNumber}–{g.maxNumber}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/sessions/new?gameType=guess_the_number&gameContentId=${g.id}`)}
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
