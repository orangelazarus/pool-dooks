import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SessionNoticeProps {
  title: string;
  message: string;
  /** When set, offers signing in and returning here — for logged-out visitors who may be players. */
  signInNext?: string;
}

/** Shown in place of a lobby or game the viewer can't take part in. */
export function SessionNotice({ title, message, signInNext }: SessionNoticeProps) {
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <Card className="w-full max-w-sm text-center" data-session-notice>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {signInNext && (
            <Link href={`/login?next=${encodeURIComponent(signInNext)}`} className={cn(buttonVariants(), "w-full")}>
              Sign in
            </Link>
          )}
          <Link href="/home" className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            Back to games
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
