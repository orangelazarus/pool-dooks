"use client";
import { Standings } from "@/lib/game-sdk/client";

interface DiscusRevealProps {
  title: string;
  standings: Array<{ playerId: string; player: string; total: number }>;
  rounds: Array<{ category: string; puzzle: string; winner: string; won: number }>;
  bonus: { player: string; category: string; puzzle: string; picks: string[]; won: boolean } | null;
}

const money = (n: number) => `$${n.toLocaleString("en-US")}`;

export function DiscusReveal({ title, standings, rounds, bonus }: DiscusRevealProps) {
  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold text-center">{title}</h2>

      <Standings rows={standings.map((s) => ({ id: s.playerId, name: s.player, score: money(s.total) }))} />

      <div>
        <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">The puzzles</h3>
        <div className="space-y-2">
          {rounds.map((r, i) => (
            <div key={i} className="border rounded-lg p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-dooks">{r.category}</p>
              <p className="font-bold">{r.puzzle}</p>
              <p className="text-xs text-muted-foreground">
                Solved by {r.winner} for {money(r.won)}
              </p>
            </div>
          ))}
          {bonus && (
            <div className="border rounded-lg p-3 border-pool bg-pool/10">
              <p className="text-xs font-semibold uppercase tracking-wide text-dooks">Bonus round · {bonus.category}</p>
              <p className="font-bold">{bonus.puzzle}</p>
              <p className="text-xs text-muted-foreground">
                {bonus.player} picked {bonus.picks.join(" ")} and {bonus.won ? "solved it!" : "didn't get it."}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
