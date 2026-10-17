"use client";
import { Badge } from "@/components/ui/badge";

export interface StandingsRow {
  id: string;
  name: string;
  score: number | string;
  /** A short line under the name, e.g. "won 3 rounds". */
  note?: string;
}

interface StandingsProps {
  /** Already in finishing order. */
  rows: StandingsRow[];
  /** Who to pick out: the first row (default), these ids, or nobody. */
  highlight?: "first" | string[] | "none";
  title?: string;
}

/** The ranked list at the end of a game. */
export function Standings({ rows, highlight = "first", title = "Final Standings" }: StandingsProps) {
  const picked = (row: StandingsRow, i: number) =>
    highlight === "first" ? i === 0 : highlight === "none" ? false : highlight.includes(row.id);

  return (
    <div>
      {title && <h3 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">{title}</h3>}
      <div className="space-y-2">
        {rows.map((row, i) => (
          <div
            key={row.id}
            className={`flex items-center gap-3 p-3 border rounded-lg ${
              picked(row, i) ? "bg-primary/15 border-primary/60" : "bg-muted/30"
            }`}
          >
            <span className="text-sm font-bold text-muted-foreground w-5">#{i + 1}</span>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{row.name}</p>
              {row.note && <p className="text-xs text-muted-foreground">{row.note}</p>}
            </div>
            <Badge variant={picked(row, i) ? "default" : "secondary"} className="font-mono text-xs">
              {row.score}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  );
}
