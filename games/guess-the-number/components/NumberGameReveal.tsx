"use client";
import { Badge } from "@/components/ui/badge";
import { Crown } from "lucide-react";

interface Ranking {
  player: string;
  guess: number;
  distance: number;
}

interface NumberGameRevealProps {
  title: string;
  secretNumber: number;
  min: number;
  max: number;
  rankings: Ranking[];
}

export function NumberGameReveal({ title, secretNumber, min, max, rankings }: NumberGameRevealProps) {
  const winner = rankings[0];

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-1">{title}</h2>
        <p className="text-muted-foreground text-sm">Between {min} and {max}</p>
      </div>

      <div className="text-center py-8 border rounded-xl bg-card">
        <p className="text-sm text-muted-foreground mb-2">The number was</p>
        <p className="text-7xl font-black tracking-tight">{secretNumber}</p>
      </div>

      {winner && (
        <div className="flex items-center justify-center gap-2 text-yellow-600">
          <Crown className="h-5 w-5" />
          <span className="font-semibold text-lg">
            {winner.distance === 0
              ? `${winner.player} guessed it exactly!`
              : `${winner.player} was closest with ${winner.guess}`}
          </span>
        </div>
      )}

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">
          Rankings
        </h3>
        <div className="space-y-2">
          {rankings.map((r, i) => (
            <div
              key={r.player}
              className={`flex items-center gap-3 p-3 border rounded-lg ${i === 0 ? "bg-yellow-50 border-yellow-200" : "bg-muted/30"}`}
            >
              <span className="text-sm font-bold text-muted-foreground w-5">#{i + 1}</span>
              <span className="font-medium flex-1">{r.player}</span>
              <span className="font-mono font-semibold">{r.guess}</span>
              <Badge variant={i === 0 ? "default" : "secondary"} className="text-xs">
                {r.distance === 0 ? "exact!" : `off by ${r.distance}`}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
