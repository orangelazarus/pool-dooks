"use client";
import { Badge } from "@/components/ui/badge";
import { Crown } from "lucide-react";
import { Standings } from "@/lib/game-sdk/client";

interface Standing {
  playerId: string;
  player: string;
  score: number;
}

interface Finalist {
  player: string;
  /** Left during the face-off. */
  forfeited?: boolean;
  faceoff: number;
  score: number;
}

interface RoundRecap {
  stage: "main" | "faceoff";
  acronym: string;
  category: string | null;
  entries: Array<{ text: string; author: string; votes: number; won: boolean }>;
}

interface AcroRevealProps {
  title: string;
  champions: string[];
  finalists: Finalist[];
  standings: Standing[];
  rounds: RoundRecap[];
}

export function AcroReveal({ title, champions, finalists, standings, rounds }: AcroRevealProps) {
  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-center">{title}</h2>

      {champions.length > 0 && (
        <div className="flex items-center justify-center gap-2 text-primary">
          <Crown className="h-5 w-5" />
          <span className="font-semibold text-lg">
            {champions.length > 1
              ? `${champions.join(" and ")} tied — shared win!`
              : finalists.length > 0
                ? `${champions[0]} won the face-off!`
                : `${champions[0]} won!`}
          </span>
        </div>
      )}

      {finalists.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Face-off</h3>
          <div className="grid grid-cols-2 gap-2">
            {finalists.map((f) => (
              <div
                key={f.player}
                className={`p-3 border rounded-lg text-center ${
                  champions.includes(f.player) ? "bg-primary/15 border-primary/60" : "bg-muted/30"
                }`}
              >
                <p className="font-medium">{f.player}</p>
                <p className="font-mono text-2xl font-bold">{f.faceoff}</p>
                <p className="text-xs text-muted-foreground">
                  {f.forfeited ? "left the face-off" : `votes · ${f.score} in the main game`}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Standings
        title="Main Game"
        highlight={finalists.length > 0 ? "none" : "first"}
        rows={standings.map((s) => ({ id: s.playerId, name: s.player, score: s.score }))}
      />

      {rounds.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">The Acronyms</h3>
          <div className="space-y-4">
            {rounds.map((round, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold tracking-widest text-primary">{round.acronym}</span>
                  {round.category && (
                    <Badge variant="outline" className="text-xs">
                      {round.category}
                    </Badge>
                  )}
                  {round.stage === "faceoff" && <Badge className="text-xs">Face-off</Badge>}
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {round.entries.map((e) => (
                    <li key={e.author}>
                      <span className={`font-semibold ${e.won ? "text-primary" : "text-foreground"}`}>{e.text}</span> —{" "}
                      {e.author}, {e.votes} vote{e.votes === 1 ? "" : "s"}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
