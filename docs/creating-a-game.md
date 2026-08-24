# Creating a New Game

This guide walks through adding a new game to the platform. As a worked example we'll build **"Hot Take"** — the host writes a controversial opinion, players vote agree or disagree, and the reveal shows the split.

The platform handles sessions, lobbies, turn cycling, real-time sync, push notifications, and routing. You only write the game logic.

---

## How isolation works

Each game lives entirely inside `games/<game-name>/`. Deleting that directory removes the game from the platform — zero edits to any base file required.

When you run `npm run games:sync` (or `npm run dev` / `npm run build`, which run it automatically), a script scans `games/*/plugin.ts` and generates `lib/games/registry.ts`. The home page, session creation, lobby, and routing all derive from the registry.

---

## Overview of what you'll create

Everything lives inside `games/hot-take/`:

| File | Purpose |
|---|---|
| `games/hot-take/schema.ts` | Drizzle table for game content |
| `games/hot-take/plugin.ts` | All server-side logic + content API (`handleRequest`) |
| `games/hot-take/components/HotTakeBoard.tsx` | What players see during gameplay |
| `games/hot-take/components/HotTakeReveal.tsx` | End-of-game reveal screen |
| `games/hot-take/pages/BrowsePage.tsx` | Browse/create page at `/games/hot_take` |

After creating the plugin file, run `npm run games:sync` once. That's it.

---

## 1. Design your turn model

Every game shares the same turn engine:

- **`tokenOrder`** — an ordered array of string IDs, one entry per turn
- **`currentTokenIndex`** — which turn we're on
- **`currentPlayerId`** — whose turn it is

After each answer the engine advances to the next token and cycles to the next player. When `currentTokenIndex >= tokenOrder.length`, the game is complete.

For Hot Take, each player votes once on the same statement:

```
tokenOrder = ["vote_<player1id>", "vote_<player2id>", "vote_<player3id>"]
```

Each player submits `{ tokenId: "vote_<theirId>", value: "agree" | "disagree" }`. After all votes are in, the reveal fires automatically.

---

## 2. Create the DB schema

`games/hot-take/schema.ts`:

```ts
import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { profiles } from "@/lib/db/schema";

export const hotTakes = pgTable("hot_takes", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  statement: text("statement").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type HotTake = typeof hotTakes.$inferSelect;
```

`drizzle.config.ts` already includes `games/*/schema.ts` in its schema glob, so Drizzle picks this up automatically.

### Run the migration

The app DB user can't `CREATE TABLE`, so run this in the **Supabase SQL Editor**:

```sql
CREATE TABLE hot_takes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  statement text NOT NULL,
  created_at timestamptz DEFAULT now()
);
```

---

## 3. Write the plugin

`games/hot-take/plugin.ts` — this is the heart of the game. It implements all server-side logic and also handles its own content API via `handleRequest`.

```ts
import { NextRequest, NextResponse } from "next/server";
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { hotTakes } from "./schema";
import { HotTakeBoard } from "./components/HotTakeBoard";
import { HotTakeReveal } from "./components/HotTakeReveal";
import BrowsePage from "./pages/BrowsePage";

export const plugin: GamePlugin = {
  gameType: "hot_take",
  displayName: "Hot Take",
  description: "Vote agree or disagree on a spicy statement — see where everyone stands",
  browsePath: "/games/hot_take",
  minPlayers: 2,
  maxPlayers: 16,
  supportsRandomize: false,

  async getContentMeta(gameContentId) {
    const [row] = await db
      .select({ statement: hotTakes.statement })
      .from(hotTakes)
      .where(eq(hotTakes.id, gameContentId));
    if (!row) throw new Error("Hot take not found");
    return { title: row.statement };
  },

  async getLobbyMeta(session) {
    const [row] = await db
      .select({ statement: hotTakes.statement })
      .from(hotTakes)
      .where(eq(hotTakes.id, session.gameContentId!));
    return { subtitle: row?.statement ?? "" };
  },

  async start(session, players) {
    const sorted = [...players].sort((a, b) => a.joinOrder - b.joinOrder);
    const tokenOrder = sorted.map((p) => `vote_${p.playerId}`);
    return { tokenOrder, firstPlayerId: sorted[0]?.playerId };
  },

  async getAnswerHints() {
    return { nextTokenLabel: "vote" };
  },

  async buildPlayProps(session) {
    const [row] = await db
      .select({ statement: hotTakes.statement })
      .from(hotTakes)
      .where(eq(hotTakes.id, session.gameContentId!));
    if (!row) throw new Error("Hot take not found");

    const tokenOrder = (session.tokenOrder ?? []) as string[];
    const currentTokenId = tokenOrder[session.currentTokenIndex ?? 0];

    return {
      statement: row.statement,
      tokenOrder,
      initialCurrentTokenId: currentTokenId,
      initialCurrentPlayerId: session.currentPlayerId ?? session.hostId,
      initialTokenIndex: session.currentTokenIndex ?? 0,
    };
  },

  async buildResult(session, answers) {
    const [row] = await db
      .select({ statement: hotTakes.statement })
      .from(hotTakes)
      .where(eq(hotTakes.id, session.gameContentId!));

    const votes = answers.map((a) => ({
      player: (a as Answer & { username?: string | null }).username ?? "Unknown",
      vote: a.value as "agree" | "disagree",
    }));

    return {
      statement: row?.statement ?? "",
      votes,
      agreeCount: votes.filter((v) => v.vote === "agree").length,
      disagreeCount: votes.filter((v) => v.vote === "disagree").length,
    };
  },

  // Content API — routes /api/games/hot_take/... land here
  async handleRequest(req, path) {
    const [seg0] = path;

    if (req.method === "GET" && !seg0) {
      const rows = await db
        .select({ id: hotTakes.id, statement: hotTakes.statement, createdAt: hotTakes.createdAt })
        .from(hotTakes)
        .orderBy(desc(hotTakes.createdAt))
        .limit(20);
      return NextResponse.json(rows);
    }

    if (req.method === "POST" && !seg0) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

      const { statement } = await req.json();
      if (!statement?.trim()) return NextResponse.json({ error: "Statement required" }, { status: 400 });

      const [row] = await db
        .insert(hotTakes)
        .values({ authorId: user.id, statement: statement.trim() })
        .returning();

      return NextResponse.json({ id: row.id, statement: row.statement }, { status: 201 });
    }

    return NextResponse.json({ error: "Not found" }, { status: 404 });
  },

  PlayComponent: HotTakeBoard,
  RevealComponent: HotTakeReveal,
  BrowsePage,
};
```

### What each method does

**`getContentMeta(gameContentId)`**
Returns `{ title }` for a piece of game content. Used in the session creation UI and lobby. Throw if not found.

**`getLobbyMeta(session)`**
Returns `{ subtitle }` shown under the game name in the lobby. Optional method.

**`start(session, players, randomize)`**
Called when the host presses Start. Build and return `tokenOrder`. Return `firstPlayerId` to set who goes first.

**`getAnswerHints(ctx)`**
Called after each answer. Returns `{ nextTokenLabel }` for push notifications.

**`buildPlayProps(session, players)`**
Called server-side to render the play page. Always include `initialCurrentTokenId`, `initialCurrentPlayerId`, and `initialTokenIndex`.

**`buildResult(session, answers)`**
Called server-side for the reveal page. `answers` rows include a joined `username` field.

**`handleRequest(req, path)`**
Handles all HTTP requests routed to `/api/games/hot_take/[...path]`. `path` is the segments after the game type (empty array for the root).

---

## 4. Write the Play component

`games/hot-take/components/HotTakeBoard.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";
import { useGameState } from "@/hooks/useGameState";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

interface HotTakeBoardProps {
  shareCode: string;
  currentUserId: string;
  players: Array<{ playerId: string; username: string }>;
  statement: string;
  tokenOrder: string[];
  initialCurrentTokenId: string;
  initialCurrentPlayerId: string;
  initialTokenIndex: number;
}

export function HotTakeBoard({
  shareCode,
  currentUserId,
  players,
  statement,
  tokenOrder,
  initialCurrentTokenId,
  initialCurrentPlayerId,
  initialTokenIndex,
}: HotTakeBoardProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const { state, handleEvent } = useGameState(players, {
    tokenOrder,
    currentTokenId: initialCurrentTokenId,
    currentPlayerId: initialCurrentPlayerId,
    tokenIndex: initialTokenIndex,
  });

  useSession(shareCode, (event) => {
    handleEvent(event);
    if (event.type === "session:completed" || event.type === "session:revealed") {
      router.push(`/sessions/${shareCode}/reveal`);
    }
  });

  const myTokenId = `vote_${currentUserId}`;
  const hasVoted = state.answeredTokenIds.has(myTokenId);
  const isMyTurn = state.currentPlayerId === currentUserId;
  const votedCount = state.answeredTokenIds.size;
  const currentPlayer = players.find((p) => p.playerId === state.currentPlayerId);

  const submitVote = async (vote: "agree" | "disagree") => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/sessions/${shareCode}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: state.currentTokenId, value: vote }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (data.isComplete) router.push(`/sessions/${shareCode}/reveal`);
    } catch {
      toast.error("Failed to submit vote");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-12 space-y-8">
      <p className="text-xl font-semibold text-center leading-snug">{statement}</p>
      <p className="text-sm text-center text-muted-foreground">
        {votedCount} of {tokenOrder.length} voted
      </p>

      {hasVoted ? (
        <p className="text-center text-muted-foreground">Your vote is in. Waiting for others...</p>
      ) : isMyTurn ? (
        <div className="flex gap-3">
          <Button className="flex-1" onClick={() => submitVote("agree")} disabled={submitting}>
            Agree
          </Button>
          <Button className="flex-1" variant="outline" onClick={() => submitVote("disagree")} disabled={submitting}>
            Disagree
          </Button>
        </div>
      ) : (
        <p className="text-center text-muted-foreground">
          Waiting for <strong>{currentPlayer?.username ?? "..."}</strong> to vote...
        </p>
      )}
    </div>
  );
}
```

### Key patterns

**`useGameState(players, initialOverride)`**
Initializes client-side state from server-rendered props. Always pass the three `initial*` props.

**`useSession(shareCode, onEvent)`**
Subscribes to Supabase Realtime. Pass every event through `handleEvent` first, then handle navigation. Always redirect on `session:completed` or `session:revealed`.

**`state.answeredTokenIds`**
A `Set<string>` of answered token IDs. Use `.has(id)` and `.size`.

**Submit shape**
Always POST `{ tokenId: state.currentTokenId, value: string }` to `/api/sessions/${shareCode}/answer`.

---

## 5. Write the Reveal component

`games/hot-take/components/HotTakeReveal.tsx`:

```tsx
interface HotTakeRevealProps {
  statement: string;
  votes: Array<{ player: string; vote: "agree" | "disagree" }>;
  agreeCount: number;
  disagreeCount: number;
}

export function HotTakeReveal({ statement, votes, agreeCount, disagreeCount }: HotTakeRevealProps) {
  const total = votes.length;
  return (
    <div className="max-w-md mx-auto px-4 py-12 space-y-8">
      <p className="text-xl font-semibold text-center">{statement}</p>

      <div className="flex gap-4 text-center">
        <div className="flex-1 border rounded-lg p-4">
          <p className="text-3xl font-bold">{agreeCount}</p>
          <p className="text-sm text-muted-foreground">Agree</p>
          <p className="text-xs text-muted-foreground">{Math.round((agreeCount / total) * 100)}%</p>
        </div>
        <div className="flex-1 border rounded-lg p-4">
          <p className="text-3xl font-bold">{disagreeCount}</p>
          <p className="text-sm text-muted-foreground">Disagree</p>
          <p className="text-xs text-muted-foreground">{Math.round((disagreeCount / total) * 100)}%</p>
        </div>
      </div>

      <div className="space-y-2">
        {votes.map((v, i) => (
          <div key={i} className="flex items-center justify-between text-sm border rounded px-3 py-2">
            <span>{v.player}</span>
            <span className={v.vote === "agree" ? "text-green-600 font-medium" : "text-red-500 font-medium"}>
              {v.vote}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 6. Create the browse page

`games/hot-take/pages/BrowsePage.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function BrowsePage() {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [recent, setRecent] = useState<Array<{ id: string; statement: string }>>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/games/hot_take").then((r) => r.json()).then(setRecent).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!statement.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/games/hot_take", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statement }),
      });
      if (!res.ok) throw new Error();
      const { id } = await res.json();
      router.push(`/sessions/new?gameType=hot_take&gameContentId=${id}`);
    } catch {
      toast.error("Failed to create");
      setCreating(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold">Hot Take</h1>
      <Card>
        <CardHeader><CardTitle className="text-base">Write a Hot Take</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            placeholder="Pineapple belongs on pizza."
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            rows={3}
          />
          <Button onClick={handleCreate} disabled={creating || !statement.trim()} className="w-full">
            {creating ? "Creating..." : "Create & Start Session"}
          </Button>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <div className="space-y-2">
          {recent.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-4 flex items-center justify-between gap-3">
                <p className="text-sm">{r.statement}</p>
                <Button size="sm" variant="outline"
                  onClick={() => router.push(`/sessions/new?gameType=hot_take&gameContentId=${r.id}`)}>
                  Play
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
```

> **API convention**: Call your game's own APIs at `/api/games/<gameType>/...` — this routes to your `handleRequest` method.

---

## 7. Sync the registry

```bash
npm run games:sync
```

This scans `games/*/plugin.ts` (looking for `export const plugin`) and regenerates `lib/games/registry.ts`. The game appears on the home page automatically. `npm run dev` and `npm run build` run this automatically via `predev`/`prebuild`.

---

## Checklist

- [ ] `games/hot-take/schema.ts` — Drizzle table
- [ ] SQL `CREATE TABLE` run in Supabase SQL Editor
- [ ] `games/hot-take/plugin.ts` — implements all required `GamePlugin` methods + `handleRequest` + `BrowsePage`
- [ ] `games/hot-take/components/HotTakeBoard.tsx`
- [ ] `games/hot-take/components/HotTakeReveal.tsx`
- [ ] `games/hot-take/pages/BrowsePage.tsx`
- [ ] `npm run games:sync` (or just `npm run dev`)

To remove a game: delete `games/hot-take/` and run `npm run games:sync`.

---

## Common mistakes

**`buildPlayProps` missing initial state**
If you don't return `initialCurrentTokenId`, `initialCurrentPlayerId`, and `initialTokenIndex`, the board will be blank until the next Realtime event fires.

**Wrong `tokenId` in submit**
Always send `tokenId: state.currentTokenId` — not a token ID you constructed yourself.

**Answers table unique constraint**
There's a unique constraint on `(sessionId, tokenId)`. Design your `tokenOrder` so IDs are unique per turn (e.g. prefix with player ID).

**`buildResult` gets answers without usernames by default**
The reveal route joins `profiles` for you — each `Answer` row has `username` available as `(answer as Answer & { username?: string | null }).username`.

**Forgot to handle `session:revealed`**
Both `session:completed` and `session:revealed` are broadcast. Handle both or players mid-load may miss the redirect.

**`browsePath` must match `gameType` with underscores**
Use `/games/hot_take` (underscore), not `/games/hot-take` (hyphen) — the dynamic route matches `gameType` exactly.
