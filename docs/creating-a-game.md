# Creating a New Game

This guide walks through adding a new game to the platform. As a worked example we'll build **"Hot Take"** — the host writes a controversial opinion, players vote agree or disagree, and the reveal shows the split.

The platform handles sessions, lobbies, turn cycling, real-time sync, push notifications, and routing. You only write the game logic.

---

## Overview of what you'll create

| File | Purpose |
|---|---|
| `lib/db/schema.ts` | DB table for your game's content |
| SQL migration | Run in Supabase to create the table |
| `app/api/hot-takes/route.ts` | API to create/list content |
| `lib/games/hot-take/plugin.ts` | The plugin — all server-side game logic |
| `components/games/hot-take/HotTakeBoard.tsx` | What players see during gameplay |
| `components/games/hot-take/HotTakeReveal.tsx` | The end-of-game reveal screen |
| `app/(app)/games/hot-take/page.tsx` | Browse/create page for this game |
| `lib/games/registry.ts` | Register the plugin (one line) |

---

## 1. Design your turn model

Every game shares the same turn engine:

- **`tokenOrder`** — an ordered array of string IDs, one entry per turn
- **`currentTokenIndex`** — which turn we're on
- **`currentPlayerId`** — whose turn it is

After each answer, the engine advances to the next token and cycles to the next player. When `currentTokenIndex >= tokenOrder.length`, the game is complete.

For Hot Take, each player votes once on the same statement, so:

```
tokenOrder = ["vote_<player1id>", "vote_<player2id>", "vote_<player3id>"]
```

One entry per player. Each player submits `{ tokenId: "vote_<theirId>", value: "agree" | "disagree" }`. After all votes are in, the reveal fires automatically.

For a trivia game you might do one entry per question per player, or one entry per question with all players answering simultaneously (same tokenId for everyone — answered once, game advances). Think through what one "turn" means in your game before writing code.

---

## 2. Add a DB table

Open `lib/db/schema.ts` and add your table at the bottom (before the TypeScript type exports):

```ts
export const hotTakes = pgTable("hot_takes", {
  id: uuid("id").primaryKey().defaultRandom(),
  authorId: uuid("author_id").references(() => profiles.id, { onDelete: "set null" }),
  statement: text("statement").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
```

Also export the inferred type:

```ts
export type HotTake = typeof hotTakes.$inferSelect;
```

Add it to `lib/db/index.ts` exports:

```ts
export { hotTakes } from "./schema";
```

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

## 3. Create the content API

`app/api/hot-takes/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { db, hotTakes } from "@/lib/db";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const rows = await db
    .select({ id: hotTakes.id, statement: hotTakes.statement, createdAt: hotTakes.createdAt })
    .from(hotTakes)
    .orderBy(desc(hotTakes.createdAt))
    .limit(20);
  return NextResponse.json(rows);
}

export async function POST(req: NextRequest) {
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
```

---

## 4. Write the plugin

`lib/games/hot-take/plugin.ts`:

```ts
import type { GamePlugin, SessionPlayerInfo, AnswerContext } from "@/lib/games/types";
import type { Session, Answer } from "@/lib/db/schema";
import { db, hotTakes } from "@/lib/db";
import { eq } from "drizzle-orm";
import { HotTakeBoard } from "@/components/games/hot-take/HotTakeBoard";
import { HotTakeReveal } from "@/components/games/hot-take/HotTakeReveal";

export const hotTakePlugin: GamePlugin = {
  gameType: "hot_take",
  displayName: "Hot Take",
  description: "Vote agree or disagree on a spicy statement — see where everyone stands",
  browsePath: "/games/hot-take",
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
    // One vote token per player, in join order
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

    const agreeCount = votes.filter((v) => v.vote === "agree").length;
    const disagreeCount = votes.filter((v) => v.vote === "disagree").length;

    return {
      statement: row?.statement ?? "",
      votes,
      agreeCount,
      disagreeCount,
    };
  },

  PlayComponent: HotTakeBoard,
  RevealComponent: HotTakeReveal,
};
```

### What each method does

**`getContentMeta(gameContentId)`**
Returns `{ title }` for a piece of game content. Used in the session creation UI and lobby. Throw if not found.

**`getLobbyMeta(session)`**
Returns `{ subtitle }` shown under the game name in the lobby. Optional — omit the key from the object to show nothing.

**`start(session, players, randomize)`**
Called when the host presses Start. Build and return `tokenOrder` — the ordered list of turn IDs for the entire game. Return `firstPlayerId` to set who goes first (defaults to host if omitted).

**`getAnswerHints(ctx)`**
Called after each answer. Returns `{ nextTokenLabel }` used in the "Your turn!" push notification body. Return `{}` to use the default "word".

**`buildPlayProps(session, players)`**
Called server-side when rendering the play page. Return whatever props your `PlayComponent` needs beyond the common ones (`shareCode`, `currentUserId`, `hostId`, `players`). Always include `initialCurrentTokenId`, `initialCurrentPlayerId`, and `initialTokenIndex` so the board can initialize correctly.

**`buildResult(session, answers)`**
Called server-side for the reveal page. The `answers` array rows include a joined `username` field. Return whatever props your `RevealComponent` needs.

---

## 5. Write the Play component

`components/games/hot-take/HotTakeBoard.tsx`:

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
Initializes client-side state from server-rendered props. Pass `initialCurrentTokenId`, `initialCurrentPlayerId`, and `initialTokenIndex` so the board is correct on first render without waiting for a Realtime event.

**`useSession(shareCode, onEvent)`**
Subscribes to Supabase Realtime. Pass every event through `handleEvent` first, then handle navigation side effects. Always redirect to `/sessions/${shareCode}/reveal` on `session:completed` or `session:revealed`.

**`state.answeredTokenIds`**
A `Set<string>` of token IDs that have been answered this session. Use `.has(id)` and `.size`.

**Submit shape**
Always POST `{ tokenId: state.currentTokenId, value: string }` to `/api/sessions/${shareCode}/answer`. The `tokenId` must match what the server expects — use `state.currentTokenId`, not a hardcoded value.

---

## 6. Write the Reveal component

`components/games/hot-take/HotTakeReveal.tsx`:

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

The `RevealComponent` is a plain server-renderable component. It receives exactly what `buildResult` returns (plus nothing extra). No hooks, no data fetching — the server page handles all of that.

---

## 7. Create the browse page

`app/(app)/games/hot-take/page.tsx`:

```tsx
"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export default function HotTakePage() {
  const router = useRouter();
  const [statement, setStatement] = useState("");
  const [recent, setRecent] = useState<Array<{ id: string; statement: string }>>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch("/api/hot-takes").then((r) => r.json()).then(setRecent).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!statement.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/hot-takes", {
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

---

## 8. Register the plugin

Open `lib/games/registry.ts` and add one line:

```ts
import { hotTakePlugin } from "./hot-take/plugin";

const registry = new Map<string, GamePlugin>([
  ["pool_dooks", poolDooksPlugin],
  ["guess_the_number", guessTheNumberPlugin],
  ["hot_take", hotTakePlugin],           // ← add this
]);
```

That's it. The home page, session creation flow, lobby, play page, and reveal page all pick up the new game automatically.

---

## Checklist

- [ ] DB table added to `lib/db/schema.ts` and `lib/db/index.ts`
- [ ] SQL `CREATE TABLE` run in Supabase SQL Editor
- [ ] Content API at `app/api/<game>/route.ts`
- [ ] Plugin at `lib/games/<game>/plugin.ts` implementing all required methods
- [ ] `PlayComponent` at `components/games/<game>/`
- [ ] `RevealComponent` at `components/games/<game>/`
- [ ] Browse page at `app/(app)/games/<game>/page.tsx`
- [ ] Plugin registered in `lib/games/registry.ts`

---

## Common mistakes

**`buildPlayProps` missing initial state**
If you don't return `initialCurrentTokenId`, `initialCurrentPlayerId`, and `initialTokenIndex`, the board won't know whose turn it is on first render. It will look blank until the next Realtime event fires.

**Wrong `tokenId` in submit**
Always send `tokenId: state.currentTokenId` — not a token ID you constructed yourself. The server validates that the submitted token matches the current index.

**Answers table unique constraint**
There's a unique constraint on `(sessionId, tokenId)`. If two players have the same `tokenId`, only the first answer is stored. Design your `tokenOrder` so token IDs are unique per turn (e.g. prefix with player ID as shown above).

**`buildResult` gets answers without usernames by default**
The reveal route joins `profiles` for you — each `Answer` row has a `username` field available as `(answer as Answer & { username?: string | null }).username`.

**Forgot to handle `session:revealed`**
Both `session:completed` and `session:revealed` are broadcast when the game ends. Handle both in your `useSession` callback or players who are mid-page-load may miss the redirect.
