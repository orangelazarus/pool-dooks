"use client";
import { Badge } from "@/components/ui/badge";
import { Crown } from "lucide-react";

interface Standing {
  playerId: string;
  player: string;
  score: number;
}

interface RoundRecap {
  prompt: string;
  answer: string;
  choices: Array<{ text: string; isTruth: boolean; authors: string[]; pickers: string[] }>;
}

interface SubterfugeRevealProps {
  title: string;
  standings: Standing[];
  rounds: RoundRecap[];
}

export function SubterfugeReveal({ title, standings, rounds }: SubterfugeRevealProps) {
  const winner = standings[0];

  return (
    <div className="space-y-8">
      <h2 className="text-2xl font-bold text-center">{title}</h2>

      {winner && (
        <div className="flex items-center justify-center gap-2 text-primary">
          <Crown className="h-5 w-5" />
          <span className="font-semibold text-lg">
            {winner.player} won with {winner.score} points!
          </span>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Final Standings</h3>
        <div className="space-y-2">
          {standings.map((s, i) => (
            <div
              key={s.playerId}
              className={`flex items-center gap-3 p-3 border rounded-lg ${
                i === 0 ? "bg-primary/15 border-primary/60" : "bg-muted/30"
              }`}
            >
              <span className="text-sm font-bold text-muted-foreground w-5">#{i + 1}</span>
              <span className="font-medium flex-1">{s.player}</span>
              <Badge variant={i === 0 ? "default" : "secondary"} className="font-mono text-xs">
                {s.score}
              </Badge>
            </div>
          ))}
        </div>
      </div>

      {rounds.length > 0 && (
        <div>
          <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">The Questions</h3>
          <div className="space-y-4">
            {rounds.map((round, i) => (
              <div key={i} className="border rounded-lg p-3 space-y-2">
                <p className="text-sm font-medium">
                  {round.prompt.includes("_____")
                    ? round.prompt.replace("_____", round.answer)
                    : `${round.prompt} ${round.answer}`}
                </p>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {round.choices
                    // Decoys only matter if someone fell for one.
                    .filter((c) => !c.isTruth && (c.authors.length > 0 || c.pickers.length > 0))
                    .map((c) => (
                      <li key={c.text}>
                        <span className="font-semibold text-foreground">{c.text}</span> — {c.authors.join(" & ") || "a decoy"}
                        {c.pickers.length > 0 ? `, fooled ${c.pickers.join(", ")}` : ", fooled nobody"}
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
