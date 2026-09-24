"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dices, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { RULESETS, type Ruleset } from "../scoring";

interface FarkleGame {
  id: string;
  title: string;
  targetScore: number;
  ruleset: Ruleset;
}

const TARGET_SCORES = [2000, 3000, 5000] as const;

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<FarkleGame[]>([]);
  const [title, setTitle] = useState("");
  const [targetScore, setTargetScore] = useState<number>(3000);
  const [ruleset, setRuleset] = useState<Ruleset>("original");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/games/farkle")
      .then((r) => r.json())
      .then(setGames)
      .catch(() => {});
  }, []);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const res = await fetch("/api/games/farkle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim() || undefined, targetScore, ruleset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ? JSON.stringify(data.error) : "Failed to create game");
      router.push(`/sessions/new?gameType=farkle&gameContentId=${data.id}`);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  const meta = RULESETS[ruleset];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Dices className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Farkle</h1>
          <p className="text-muted-foreground text-sm">Roll six dice, bank before you bust</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>Pick a target score and a ruleset — the two rulesets score dice differently.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title (optional)</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Friday night farkle"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1 space-y-1.5">
              <Label>Target score</Label>
              <Select value={String(targetScore)} onValueChange={(v) => v && setTargetScore(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_SCORES.map((s) => (
                    <SelectItem key={s} value={String(s)}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex-1 space-y-1.5">
              <Label>Ruleset</Label>
              <Select value={ruleset} onValueChange={(v) => v && setRuleset(v as Ruleset)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.values(RULESETS)).map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            {meta.bullets.map((b) => (
              <li key={b}>{b}</li>
            ))}
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
                      {RULESETS[g.ruleset].label} · First to {g.targetScore}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => router.push(`/sessions/new?gameType=farkle&gameContentId=${g.id}`)}
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
