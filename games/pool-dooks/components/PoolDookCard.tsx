"use client";
import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ThemeBadge } from "./ThemeBadge";
import { Gamepad2, Sparkles, Zap } from "lucide-react";
import type { PoolDookToken } from "../schema";
import { cn } from "@/lib/utils";

interface PoolDookCardProps {
  poolDook: {
    id: string;
    title: string;
    theme: string;
    tokens: unknown;
    aiGenerated?: boolean | null;
    extraWeird?: boolean | null;
    createdAt?: Date | null;
    author?: { username: string | null } | null;
  };
  showActions?: boolean;
  onDelete?: (id: string) => void;
}

export function PoolDookCard({ poolDook, showActions, onDelete }: PoolDookCardProps) {
  const tokens = (poolDook.tokens as PoolDookToken[]) ?? [];
  const tokenCount = tokens.length;

  return (
    <Card className="flex flex-col hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug line-clamp-2">
            {poolDook.title}
          </CardTitle>
          <div className="flex gap-1 shrink-0">
            {poolDook.aiGenerated && (
              <Sparkles className="h-4 w-4 text-violet-500" aria-label="AI Generated" />
            )}
            {poolDook.extraWeird && (
              <Zap className="h-4 w-4 text-orange-500" aria-label="Extra Weird" />
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 pb-3">
        <div className="flex flex-wrap gap-1.5">
          <ThemeBadge theme={poolDook.theme} />
          <Badge variant="secondary" className="text-xs">
            {tokenCount} blank{tokenCount !== 1 ? "s" : ""}
          </Badge>
        </div>
        {poolDook.author?.username && (
          <p className="text-xs text-muted-foreground mt-2">
            by @{poolDook.author.username}
          </p>
        )}
      </CardContent>

      <CardFooter className="pt-0 gap-2">
        <Link
          href={`/sessions/new?gameType=pool_dooks&gameContentId=${poolDook.id}`}
          className={cn(buttonVariants({ size: "sm" }), "flex-1 gap-1.5")}
        >
          <Gamepad2 className="h-3.5 w-3.5" />
          Play
        </Link>
        {showActions && (
          <>
            <Link
              href={`/games/pool_dooks/create?edit=${poolDook.id}`}
              className={buttonVariants({ size: "sm", variant: "outline" })}
            >
              Edit
            </Link>
            {onDelete && (
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => onDelete(poolDook.id)}
              >
                Delete
              </Button>
            )}
          </>
        )}
      </CardFooter>
    </Card>
  );
}
