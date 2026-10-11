import Link from "next/link";
import { listPlugins } from "@/lib/games/registry";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { listOpenSessions, type OpenSession } from "@/lib/sessions/public";
import { Eye, Users } from "lucide-react";

export const dynamic = "force-dynamic";

function OpenSessionList({
  title,
  hint,
  action,
  sessions,
  href,
}: {
  title: string;
  hint: string;
  action: string;
  sessions: OpenSession[];
  href: (s: OpenSession) => string;
}) {
  return (
    <div data-open-list={action.toLowerCase()}>
      <h3 className="font-semibold text-sm flex items-center gap-2 mb-2">
        {action === "Watch" ? <Eye className="h-4 w-4" /> : <Users className="h-4 w-4" />}
        {title}
      </h3>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{hint}</p>
      ) : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.shareCode} data-open-session={s.shareCode} className="flex items-center gap-3 border rounded-lg p-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{s.gameDisplayName}</p>
                <p className="text-xs text-muted-foreground truncate">
                  Hosted by {s.hostName} · {s.playerCount}/{s.maxPlayers} players
                </p>
              </div>
              <Link href={href(s)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {action}
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default async function HomePage() {
  const plugins = listPlugins();
  const { joinable, watchable } = await listOpenSessions();

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Games</h1>
          <p className="text-muted-foreground mt-1">Pick a game to play with friends</p>
        </div>
        <Link href="/sessions/new" className={cn(buttonVariants({ variant: "outline" }), "gap-2")}>
          Join by code
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {plugins.map((plugin) => (
          <Card key={plugin.gameType} className="hover:shadow-md transition-shadow">
            <CardHeader>
              <CardTitle>{plugin.displayName}</CardTitle>
              <CardDescription>{plugin.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href={plugin.browsePath} className={cn(buttonVariants(), "w-full")}>
                Play
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-10">
        <h2 className="text-xl font-bold tracking-tight">Open games</h2>
        <p className="text-muted-foreground text-sm mt-1 mb-4">Public games anyone can join or watch</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <OpenSessionList
            title="Waiting for players"
            hint="No open lobbies right now. Start a game and make it public to see it here."
            action="Join"
            sessions={joinable}
            href={(s) => `/sessions/${s.shareCode}`}
          />
          <OpenSessionList
            title="In progress"
            hint="No public games being played right now."
            action="Watch"
            sessions={watchable}
            href={(s) => `/sessions/${s.shareCode}/play`}
          />
        </div>
      </div>
    </div>
  );
}
