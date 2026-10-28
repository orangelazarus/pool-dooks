"use client";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { FinishedSession } from "@/lib/sessions/history";

// Formatted in the browser, so the date is the viewer's own.
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

/** Where "Play again" goes: a new game with the same setup, timer and turn order. */
function playAgainHref(gameType: string, again: NonNullable<FinishedSession["playAgain"]>) {
  const params = new URLSearchParams({ gameType, gameContentId: again.gameContentId });
  if (again.timerSeconds) params.set("timer", String(again.timerSeconds));
  if (again.randomize) params.set("randomize", "1");
  return `/sessions/new?${params}`;
}

/**
 * Finished games of one game type, the viewer's own and public ones, each with
 * its result and a way to play again by the same rules. Core shows it under
 * every game's browse page; games don't render it themselves.
 */
export function RecentGames({ gameType, games }: { gameType: string; games: FinishedSession[] }) {
  if (games.length === 0) return null;
  return (
    <div className="max-w-2xl mx-auto px-4 pb-8">
      <h2 className="font-semibold mb-3 text-sm text-muted-foreground uppercase tracking-wide">Recently Played</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {games.map((g) => (
          <Card key={g.shareCode} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 space-y-3">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <p className="font-medium text-sm">{g.title ?? "Game"}</p>
                  {g.mine && <Badge variant="secondary" className="shrink-0">You played</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {g.players.length > 0 && <>with {g.players.join(", ")} · </>}
                  {day(g.completedAt)}
                </p>
              </div>
              <div className="flex gap-2">
                <Link href={`/sessions/${g.shareCode}/reveal`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  See result
                </Link>
                {g.playAgain && (
                  <Link href={playAgainHref(gameType, g.playAgain)} className={buttonVariants({ size: "sm" })}>
                    Play again
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
