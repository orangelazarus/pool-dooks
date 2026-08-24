import Link from "next/link";
import { listPlugins } from "@/lib/games/registry";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export default function HomePage() {
  const plugins = listPlugins();

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
    </div>
  );
}
