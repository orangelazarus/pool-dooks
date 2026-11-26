"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brush, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { contentAction } from "@/lib/game-sdk/client";
import { STEP_OPTIONS, stepsLabel, type StepsSetting } from "../schema";

const GAME = "eat_poop_you_cat";

interface EpycGame {
  id: string;
  title: string;
  summary: string;
}

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<EpycGame[]>([]);
  const [steps, setSteps] = useState<StepsSetting>("full");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    contentAction<EpycGame[]>(GAME, "list", undefined, "GET")
      .then(setGames)
      .catch(() => {});
  }, []);

  const play = (id: string) => router.push(`/sessions/new?gameType=${GAME}&gameContentId=${id}`);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await contentAction<{ id: string }>(GAME, "create", { steps });
      play(data.id);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <Brush className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Eat Poop You Cat</h1>
          <p className="text-muted-foreground text-sm">Telephone, with pictures</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>
            Everyone starts a book by writing a phrase. Each book is passed along: the next player draws the phrase, the
            one after describes the drawing, the next draws that, and so on. Nobody sees anything but the page before
            theirs, until the end, when every book is revealed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label>Book length</Label>
            <Select value={String(steps)} onValueChange={(v) => v && setSteps(v === "full" ? "full" : (Number(v) as 4 | 6))}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STEP_OPTIONS.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s === "full" ? "Full circle: every player adds to every book" : `Up to ${stepsLabel(s)} per book`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>
              <strong>No timer:</strong> play at your own pace. A book moves on as soon as its holder finishes, and you
              get a notification when one reaches you.
            </li>
            <li>
              <strong>With a timer:</strong> play live. Everyone takes each turn together, and time&apos;s up moves the
              books on.
            </li>
            <li>3 to 8 players. You pick the timer on the next screen.</li>
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
                    <p className="text-xs text-muted-foreground">{g.summary}</p>
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
