"use client";
import { Badge } from "@/components/ui/badge";
import { Crown } from "lucide-react";
import { RULESETS, type Ruleset } from "../scoring";

interface Standing {
  playerId: string;
  player: string;
  score: number;
}

interface FarkleRevealProps {
  title: string;
  ruleset: Ruleset;
  targetScore: number;
  standings: Standing[];
}

export function FarkleReveal({ title, ruleset, targetScore, standings }: FarkleRevealProps) {
  const winner = standings[0];
  const meta = RULESETS[ruleset];

  return (
    <div className="space-y-8">
      <div className="text-center space-y-1">
        <h2 className="text-2xl font-bold">{title}</h2>
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Badge variant="outline">{meta.label}</Badge>
          <span>First to {targetScore}</span>
        </div>
      </div>

      {winner && (
        <div className="flex items-center justify-center gap-2 text-yellow-600">
          <Crown className="h-5 w-5" />
          <span className="font-semibold text-lg">
            {winner.player} won with {winner.score} points!
          </span>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
          Final Standings
        </h3>
        <div className="space-y-2">
          {standings.map((s, i) => (
            <div
              key={s.playerId}
              className={`flex items-center gap-3 p-3 border rounded-lg ${
                i === 0 ? "bg-yellow-50 border-yellow-200" : "bg-muted/30"
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
    </div>
  );
}
