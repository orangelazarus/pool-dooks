"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CaseUpper, Gamepad2 } from "lucide-react";
import { toast } from "sonner";
import { contentAction } from "@/lib/game-sdk/client";
import { CATEGORY_MODE_LABELS, CATEGORY_MODES, FACEOFF_OPTIONS, TARGET_OPTIONS, type CategoryMode } from "../schema";

interface AcroGame {
  id: string;
  title: string;
  summary: string;
}

export default function BrowsePage() {
  const router = useRouter();
  const [games, setGames] = useState<AcroGame[]>([]);
  const [target, setTarget] = useState<number>(30);
  const [faceoffRounds, setFaceoffRounds] = useState<number>(3);
  const [categories, setCategories] = useState<CategoryMode>("random");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    contentAction<AcroGame[]>("acrophobia", "list", undefined, "GET")
      .then(setGames)
      .catch(() => {});
  }, []);

  const play = (id: string) => router.push(`/sessions/new?gameType=acrophobia&gameContentId=${id}`);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const data = await contentAction<{ id: string }>("acrophobia", "create", { target, faceoffRounds, categories });
      play(data.id);
    } catch {
      toast.error("Failed to create game");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center gap-3 mb-8">
        <CaseUpper className="h-7 w-7" />
        <div>
          <h1 className="text-2xl font-bold">Acrophobia</h1>
          <p className="text-muted-foreground text-sm">The acronym game</p>
        </div>
      </div>

      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Create a New Game</CardTitle>
          <CardDescription>
            Each round brings a random acronym. Everyone writes a phrase to fit it — <em>FBT</em> could be &ldquo;Free
            Burritos Tuesday&rdquo; — then votes for their favourite. Once someone reaches the target, the top two go
            head to head in the face-off and everyone else judges.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Score to reach the face-off</Label>
              <Select value={String(target)} onValueChange={(v) => v && setTarget(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n} points
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Face-off rounds</Label>
              <Select value={String(faceoffRounds)} onValueChange={(v) => v && setFaceoffRounds(Number(v))}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FACEOFF_OPTIONS.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Categories</Label>
            <Select value={categories} onValueChange={(v) => v && setCategories(v as CategoryMode)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_MODES.map((mode) => (
                  <SelectItem key={mode} value={mode}>
                    {CATEGORY_MODE_LABELS[mode]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categories === "winner" && (
              <p className="text-xs text-muted-foreground">
                The winner of each round chooses the next round&apos;s category from a short list, or makes one up.
              </p>
            )}
          </div>

          <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
            <li>1 point for every vote your answer gets</li>
            <li>The round&apos;s winner gets a bonus point per letter</li>
            <li>2 points for the fastest answer that got a vote</li>
            <li>1 point for voting for the winner</li>
            <li>Don&apos;t vote, don&apos;t score</li>
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
