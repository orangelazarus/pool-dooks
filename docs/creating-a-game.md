# Creating a New Game

This guide walks through adding a game to the platform. As a worked example we'll build **"Hot Take"** — the host writes a controversial opinion, players vote agree or disagree, and the reveal shows the split.

The platform handles accounts and guests, sessions, lobbies, public games and spectators, real-time sync, push notifications, storage and routing. You write the game.

Every code block below is a complete file from a working version of this example.

---

## The rules

1. **A game lives entirely inside `games/<name>/`.** Adding one needs no change to core code and no SQL. Deleting the directory removes the game.
2. **Games talk to core only through the game SDK.** Game code may import:
   - `@/lib/game-sdk` (server) and `@/lib/game-sdk/client` (browser)
   - `@/components/ui/*` and `@/lib/utils`
   - its own npm packages

   Nothing else: no database client, no Supabase, no push sender. ESLint enforces this.
3. **A game PR does not touch core.** If your game needs something the SDK doesn't offer, add it to the SDK in its own PR first. CI fails a PR that changes a game directory together with core code. The generated `lib/games/registry.ts` and `package.json` / `package-lock.json` are the only files allowed alongside a game.

The SDK is a boundary enforced by lint and review, not a sandbox: games still run in the same server process as core.

---

## What you'll create

| File | Purpose |
|---|---|
| `games/hot-take/schema.ts` | Types and Zod schemas for what the game stores and accepts |
| `games/hot-take/plugin.ts` | The game: `defineGame({...})` |
| `games/hot-take/components/HotTakeBoard.tsx` | What players (and spectators) see during play |
| `games/hot-take/components/HotTakeReveal.tsx` | End-of-game screen |
| `games/hot-take/pages/BrowsePage.tsx` | Page at `/games/hot_take`: pick or create something to play |

Then run `npm run games:sync` (or `npm run dev` / `npm run build`, which run it first). It scans `games/*/plugin.ts` and regenerates `lib/games/registry.ts`; commit that file. The game then appears on the home page.

---

## 1. Decide what you store

Core gives every game two kinds of storage, both JSON:

- **Content** — what a host sets up before a session exists, and what `sessions.game_content_id` points at. Title, author and public/private are core's columns; everything else goes in `data`.
- **State** — one row per session, for the live game. Every write is version-checked.

You describe their shapes in TypeScript and validate input with Zod. There are no tables to create.

`games/hot-take/schema.ts`:

```ts
import { z } from "zod";

/** Content row: what the host set up. */
export interface HotTakeContent {
  statement: string;
}

/** Session state: who has voted which way. */
export interface HotTakeState {
  votes: Record<string, "agree" | "disagree">;
}

export const CreateSchema = z.object({
  statement: z.string().min(5).max(200),
});

export const VoteSchema = z.object({
  vote: z.enum(["agree", "disagree"]),
});
```

---

## 2. Define the game

`games/hot-take/plugin.ts`:

```ts
import type { z } from "zod";
import { defineGame, GameError } from "@/lib/game-sdk";
import { CreateSchema, VoteSchema, type HotTakeContent, type HotTakeState } from "./schema";
import { HotTakeBoard } from "./components/HotTakeBoard";
import { HotTakeReveal } from "./components/HotTakeReveal";
import BrowsePage from "./pages/BrowsePage";

export const plugin = defineGame<HotTakeContent, HotTakeState>({
  gameType: "hot_take",
  displayName: "Hot Take",
  description: "Vote agree or disagree on a spicy statement — see where everyone stands",
  minPlayers: 2,
  maxPlayers: 16,

  async getLobbyMeta(ctx) {
    return { subtitle: ctx.session.content.data.statement };
  },

  async start(ctx) {
    await ctx.state.init({ votes: {} });
  },

  // Everything returned here is sent to the browser, so it says how many
  // have voted — never which way.
  async buildPlayProps(ctx) {
    const votes = (await ctx.state.get())?.data.votes ?? {};
    return { statement: ctx.session.content.data.statement, votedIds: Object.keys(votes) };
  },

  async buildResult(ctx) {
    const votes = (await ctx.state.get())?.data.votes ?? {};
    return {
      statement: ctx.session.content.data.statement,
      results: ctx.session.players.map((p) => ({ player: p.username, vote: votes[p.id] ?? null })),
    };
  },

  contentActions: {
    list: {
      method: "GET",
      auth: "public",
      handler: async (ctx) =>
        (await ctx.content.list({ limit: 20 })).map((take) => ({ id: take.id, statement: take.data.statement })),
    },
    create: {
      auth: "user",
      input: CreateSchema,
      handler: async (ctx, { statement }: z.infer<typeof CreateSchema>) => {
        const take = await ctx.content.create({ title: statement, data: { statement } });
        return { id: take.id };
      },
    },
  },

  sessionActions: {
    vote: {
      access: "player",
      input: VoteSchema,
      handler: async (ctx, { vote }: z.infer<typeof VoteSchema>) => {
        const stored = await ctx.state.get();
        if (!stored) throw new GameError(500, "Game state missing");
        const me = ctx.viewer!.id;
        if (stored.data.votes[me]) throw new GameError(400, "You already voted");

        const votes = { ...stored.data.votes, [me]: vote };
        await ctx.state.update({ votes }, { expectedVersion: stored.version });
        await ctx.broadcast("voted", { votedIds: Object.keys(votes) });

        if (Object.keys(votes).length >= ctx.session.players.length) {
          await ctx.finish();
          await ctx.notify("others", { title: "Hot Take", body: "Everyone has voted — see the split!" });
        }
        return { votedIds: Object.keys(votes) };
      },
    },
  },

  PlayComponent: HotTakeBoard,
  RevealComponent: HotTakeReveal,
  BrowsePage,
});
```

### Lifecycle hooks

| Hook | When | Notes |
|---|---|---|
| `start(ctx, { randomize })` | The host starts the game | Usually `ctx.state.init(...)`. May return `firstPlayerId`. |
| `buildPlayProps(ctx)` | The play page renders | Sent to the browser for players **and spectators** — never include secrets. |
| `buildResult(ctx)` | The reveal page renders | The game is over; secrets can come out. |
| `getLobbyMeta(ctx)` | The lobby renders | Optional one-line subtitle. |

Set `supportsRandomize: true` to give the host a shuffle switch when creating a session; `start` gets the choice as `randomize`, and what it shuffles is up to you. Word the switch with `randomizeText: { label, description }`, e.g. `{ label: "Randomize turn order", description: "Who goes first, and the order after, is shuffled" }`. Without it, the switch keeps Pool Dooks' wording about blanks.

### Actions

Your game's API is declared, not routed by hand. Before a handler runs, core has already:

- worked out who is calling (`ctx.viewer`, or `null`)
- checked the action's `auth` or `access` level
- for session actions: checked the session belongs to this game, that the caller may see it (private games are refused to non-players), and that it is in progress
- validated the request against `input`
- for session actions other than GET: locked the session and checked again, inside the action's transaction, so a player removed a moment ago can't still act

| | Levels | URL |
|---|---|---|
| `contentActions` | `auth: "public"` anyone · `"user"` signed in, guests included · `"account"` a signed-up account | `/api/games/<gameType>/content/<name>` |
| `sessionActions` | `access: "player"` this session's players · `"host"` only the session's host · `"viewer"` players, plus spectators of a public game | `/api/games/<gameType>/sessions/<code>/<name>` |

Use `auth: "account"` for anything costly or abusable — a guest account costs nothing to create.

Actions default to `POST`. Set `method: "GET"` for reads; input then comes from the query string, so use `z.coerce` for numbers. Player and host actions require the session to be in progress unless you set `when: "any"`.

**GET actions are read-only.** They run in a read-only transaction, and changing state, broadcasting or notifying from one fails (the test harness fails the same way). A link on another site can make a signed-in browser send a GET, so anything that changes the game must be a `POST`.

To refuse a request, `throw new GameError(status, message)`. Anything else a handler throws is logged and returned as a generic 500, so internals never reach the client.

**A session action is one transaction.** Everything a handler writes — state, turn, ending the game — is committed together when it returns. If it throws an unexpected error, all of it is rolled back, so a crash can never leave a game half-updated. Broadcasts and push notifications are held until the commit, so nobody is told about a change that didn't happen.

One subtlety: a `GameError` is a reply, not a failure. Writes made before throwing one are **kept**. That lets a handler record something and still refuse the request — Chess records a loss on time, then tells the player why their move wasn't accepted. If you want nothing saved, throw before you write.

### The context

| | |
|---|---|
| `ctx.viewer` | `{ id, username, isGuest }` or `null` |
| `ctx.content` | `create`, `get`, `list`, `update`, `remove` — this game's rows only. `get` and `list` never return someone else's private content; `update` and `remove` are author-only; `create` allows 100 a day per author. |
| `ctx.session` | Read-only: `shareCode`, `status`, `hostId`, `isPublic`, `currentPlayerId`, `players`, and `content` (the row being played) |
| `ctx.role` | `"player"`, `"observer"`, or `null` |
| `ctx.state` | `get()`, `init(data)`, `update(data, { expectedVersion })`, `mutate(change)` |
| `ctx.turn.set(playerId)` | Whose turn it is (must be one of this session's players) |
| `ctx.finish()` | Ends the game and sends everyone to the reveal |
| `ctx.broadcast(name, data)` | Realtime message to everyone with the session open. The channel is private (players, plus anyone for a public game) and only the server can send on it, so browsers can trust it — but every listener sees `data`. |
| `ctx.notify(to, { title, body })` | Push to this session's players; `"others"` is everyone but the caller. Core sets the link. |
| `ctx.answers()` | Shared turn engine only: answers given so far |
| `ctx.ai` | Content actions only: `run(use, request)` for a use declared in `ai`. See [Using AI](#using-ai) |

**Always pass `expectedVersion` from the state you read.** If another request changed the state in between, the update is refused with a 409 instead of silently overwriting — this is what stops a double-tapped button applying twice.

When everyone acts at once (all players answering the same question), those 409s are just two players' writes meeting. `ctx.state.mutate(change)` reads the state, applies `change`, writes it, and if another write landed in between, reads and applies again:

```ts
const { data, changed } = await ctx.state.mutate((state) => {
  if (state.votes[me]) throw new GameError(400, "You already voted");
  return { ...state, votes: { ...state.votes, [me]: vote } };
});
if (changed) await ctx.broadcast("changed", { count: Object.keys(data.votes).length });
```

`change` may run more than once, so it must depend only on the state it's given — take `Date.now()` or anything random *outside* it. Return the same object to write nothing.

### Helpers

`shuffle`, `pickOne` and `pickSome` come from both `@/lib/game-sdk` and `@/lib/game-sdk/client`.

### Games with one answer per turn

If your game is "each player answers one prompt in turn" (as Pool Dooks and Guess the Number are), you can skip `state` and `sessionActions` and use the shared turn engine instead: return a `tokenOrder` from `start`, have the client call `submitAnswer(shareCode, tokenId, value)`, and read the answers with `ctx.answers()` in `buildResult`. Implement `getAnswerHints` to name the next prompt for the "your turn" push. Return `answered` from it **only** if answers are meant to be public during play.

---

## 3. The play screen

`games/hot-take/components/HotTakeBoard.tsx`:

```tsx
"use client";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { gameAction, GameActionError, useGameSession } from "@/lib/game-sdk/client";

interface HotTakeBoardProps {
  // Passed to every PlayComponent by core:
  shareCode: string;
  currentUserId: string; // "" for someone watching a public game
  players: Array<{ playerId: string; username: string }>;
  // From this game's buildPlayProps:
  statement: string;
  votedIds: string[];
}

export function HotTakeBoard({ shareCode, currentUserId, players, statement, votedIds: initial }: HotTakeBoardProps) {
  const [votedIds, setVotedIds] = useState(initial);
  const [busy, setBusy] = useState(false);

  // Live updates. The hook also sends everyone to the reveal when the game ends.
  useGameSession(shareCode, {
    onEvent: (name, data) => {
      if (name === "voted") setVotedIds((data as { votedIds: string[] }).votedIds);
    },
  });

  const isPlayer = players.some((p) => p.playerId === currentUserId);
  const hasVoted = votedIds.includes(currentUserId);

  const vote = async (choice: "agree" | "disagree") => {
    setBusy(true);
    try {
      const result = await gameAction<{ votedIds: string[] }>("hot_take", shareCode, "vote", { vote: choice });
      setVotedIds(result.votedIds);
    } catch (e) {
      toast.error(e instanceof GameActionError ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-md mx-auto px-4 py-8 space-y-6 text-center">
      <h1 className="text-xl font-bold">&ldquo;{statement}&rdquo;</h1>
      <p className="text-sm text-muted-foreground">
        {votedIds.length} of {players.length} voted
      </p>
      {isPlayer && !hasVoted ? (
        <div className="flex gap-2">
          <Button className="flex-1" disabled={busy} onClick={() => vote("agree")}>
            Agree
          </Button>
          <Button className="flex-1" variant="outline" disabled={busy} onClick={() => vote("disagree")}>
            Disagree
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Waiting for the others…</p>
      )}
    </div>
  );
}
```

- Core passes `shareCode`, `currentUserId`, `hostId` and `players` to every play component, then spreads in your `buildPlayProps`.
- **Spectators get the same component** with `currentUserId` set to `""`. Design the screen so a viewer who isn't a player simply sees a read-only view; core adds the "You're watching" banner.
- `gameAction` rejects with a `GameActionError` carrying the server's message and status.
- Start from the server-rendered props and update from `useGameSession` events. Don't keep anything the server didn't send.

### Per-viewer views: `useGameView`

Many games build a different view for each viewer on the server (your own hand, nobody else's). For those, the server returns that view from a GET `state` action and from every other action, and broadcasts a bare `"changed"` when anything happens. `useGameView` then runs the whole loop:

```tsx
const { view, act, busy } = useGameView<MyView>("my_game", shareCode, initialView);
// …
<Button disabled={busy} onClick={() => act("vote", { choiceId })}>Vote</Button>
```

It fetches the view again on `"changed"` (configurable with `refreshOn`) and when the page returns from the background. It ignores replies that arrive out of order, shows a refused action as a toast (refreshing on a 409), and goes to the reveal when an action replies with `finished: true`. See `games/subterfuge`.

For the reveal, `<Standings rows={…} />` from `@/lib/game-sdk/client` is the usual ranked list.

---

## 4. The reveal

`games/hot-take/components/HotTakeReveal.tsx`:

```tsx
"use client";

interface HotTakeRevealProps {
  statement: string;
  results: Array<{ player: string; vote: "agree" | "disagree" | null }>;
}

export function HotTakeReveal({ statement, results }: HotTakeRevealProps) {
  const agree = results.filter((r) => r.vote === "agree").length;
  return (
    <div className="space-y-4 text-center">
      <h2 className="text-2xl font-bold">&ldquo;{statement}&rdquo;</h2>
      <p className="font-semibold">
        {agree} agree · {results.length - agree} disagree
      </p>
      <ul className="space-y-1 text-sm">
        {results.map((r) => (
          <li key={r.player}>
            {r.player}: {r.vote ?? "no vote"}
          </li>
        ))}
      </ul>
    </div>
  );
}
```

It receives exactly what `buildResult` returns. Core adds the Home and Play Again buttons around it.

---

## 5. The browse page

`games/hot-take/pages/BrowsePage.tsx`:

```tsx
"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { contentAction } from "@/lib/game-sdk/client";

interface Take {
  id: string;
  statement: string;
}

export default function BrowsePage() {
  const router = useRouter();
  const [takes, setTakes] = useState<Take[]>([]);
  const [statement, setStatement] = useState("");

  useEffect(() => {
    contentAction<Take[]>("hot_take", "list", undefined, "GET").then(setTakes).catch(() => {});
  }, []);

  // Core's session setup page takes it from here.
  const play = (id: string) => router.push(`/sessions/new?gameType=hot_take&gameContentId=${id}`);

  const create = async () => {
    try {
      const { id } = await contentAction<{ id: string }>("hot_take", "create", { statement });
      play(id);
    } catch {
      toast.error("Couldn't create that one");
    }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
      <h1 className="text-2xl font-bold">Hot Take</h1>
      <div className="flex gap-2">
        <Input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="Pineapple belongs on pizza" />
        <Button onClick={create} disabled={statement.trim().length < 5}>
          Create
        </Button>
      </div>
      {takes.map((take) => (
        <div key={take.id} className="flex items-center justify-between border rounded-lg p-3">
          <span className="text-sm">{take.statement}</span>
          <Button size="sm" variant="outline" onClick={() => play(take.id)}>
            Play
          </Button>
        </div>
      ))}
    </div>
  );
}
```

Send the host to `/sessions/new?gameType=<gameType>&gameContentId=<id>`; core takes it from there (public/private, lobby, share code).

Below your page, core lists the game's finished games: the viewer's own and public ones, each with **See result** and **Play again**. Play again starts a new game with the same content, timer and turn order. You don't need to list played games yourself.

A game can also export `CreatePage` (`/games/<gameType>/create`) and `LibraryPage` (`/games/<gameType>/library`).

---

## Players leaving

A player leaves only by choosing to — the Leave button, or the host removing them. Closing the tab or losing the connection never takes anyone out, so opening the invite link again puts a player straight back in their seat.

In the lobby anyone may leave (and come back through the invite link), and the host may remove players (who can't). Once a game has started, leaving is possible **only if your game defines `onPlayerLeft`**; otherwise the menu doesn't offer it and the request is refused.

```ts
async onPlayerLeft(ctx, { playerId, reason }) {
  // ctx.session.players already excludes them; if they hosted, hostId is the new host.
  await ctx.state.mutate((s) => withoutPlayer(s, playerId));
  if (ctx.session.players.length < 2) await ctx.finish();
  await ctx.broadcast("changed", {});
},
```

Use it to take care of whatever was waiting on them: their turn, their pending answer, their seat in a two-player game. Throw a `GameError` to refuse, which undoes the removal entirely. If nobody is left, core ends the game. Every open play screen re-renders with the new roster (`players`, `hostId`) on its own. Name departed players in results from `ctx.session.leftPlayers`. In tests, use `t.leave(id)` and `t.kick(id)`.

---

## Timed games

Core can offer the host a timer and fire deadlines for you. Nothing runs on a schedule. A deadline fires when an open browser's countdown reaches zero, or when the next request touches the session, whichever comes first, and it always fires exactly once.

Declare the choices, and handle the deadline:

```ts
defineGame<MyContent, MyState>({
  // …
  timer: { options: [30, 60, 90], label: "Time to answer" }, // the host may also pick "Off"

  async start(ctx) {
    await ctx.state.init(initialState);
    if (ctx.session.timerSeconds) await ctx.deadline.set(ctx.session.timerSeconds * 1000, "answering");
  },

  // Runs once, in its own transaction, before anything else sees the session.
  async onDeadline(ctx, key) {
    if (key === "answering") await ctx.state.mutate((s) => closeAnswering(s));
    await ctx.broadcast("changed", {});
  },
});
```

- `ctx.session.timerSeconds` is the host's choice, or `null` for off. What it times is up to you.
- `ctx.deadline.set(inMs, key)` replaces any pending deadline (there's one per session). `ctx.deadline.clear()` cancels it, for example when everyone has answered early. `ctx.deadline.get()` reads it.
- `ctx.viewer` in `onDeadline` is whoever's request noticed the deadline, or nobody. Don't treat it as their move.
- A game can use deadlines without offering `timer`: define `onDeadline` and set them yourself. A game that offers `timer` must define `onDeadline`.

On the play screen, every `PlayComponent` gets a `deadline` prop. Pass it to `useDeadline`, which counts down and nudges the server at zero:

```tsx
const { seconds } = useDeadline("my_game", shareCode, deadline);
{seconds !== null && <span>{seconds}s</span>}
```

`useDeadline` hears about new deadlines through `useGameSession` (or `useGameView`), so keep one of those on the page. In tests, pass `timerSeconds` to `createTestSession` and use `t.clock.advance(ms)` (or `advance(ms, { nudge: false })` to act as if no browser was watching) and `t.deadline()`.

---

## Using AI

AI costs money, so games never call a model themselves: no AI SDK, no API key, no `fetch` to a model. A game declares each way it uses AI, and core runs and meters every call. Lint enforces this.

**Declare each use** in `defineGame`. Core checks the declaration when the game loads and refuses anything over its ceilings:

```ts
const Title = z.object({ title: z.string().max(80) });

defineGame({
  ai: {
    suggestTitle: {
      tier: "fast",          // "fast" for short text, "smart" for images and harder text; core picks the model
      maxInputChars: 500,    // at most 20,000
      maxOutputTokens: 200,  // at most 4096
      images: false,         // true accepts one image per call
      output: Title,         // a zod object: the reply's shape
      perUserPerDay: 10,     // at most 20
    },
  },
  contentActions: {
    suggestTitle: {
      auth: "account",
      input: z.object({ theme: z.string().max(200) }),
      handler: async (ctx, { theme }) =>
        ctx.ai.run<z.infer<typeof Title>>("suggestTitle", { system: TITLE_PROMPT, input: theme }),
    },
  },
});
```

**What core guarantees, whatever the game does:**

- **Only signed-up accounts.** Guests and logged-out visitors get a 403 or 401.
- **Structured replies only.** The model has to fill in `output`, and the game gets the parsed object. Make it exactly what your feature needs, with `.max()` on strings. Then even a player who talks the model into something else gets back only a title-shaped object, so the feature can't be used as a free chatbot.
- **Your instructions stay yours.** Write `system` in game code. Pass player text only as `input`.
- **Daily limits** (`lib/ai/limits.ts`):
  - your `perUserPerDay`
  - 20 calls per account across all games, and 3 for an account under a day old
  - 40 calls per network
  - $2 a day per game, and $5 for the whole site
  - one call at a time per person

  Over a limit, `run` throws a `GameError` with a message players can read (429 or 503), and nothing is sent to the model.
- **A ledger.** Every call and refusal goes into `ai_usage`, and `node scripts/ai-usage.mjs` summarises it. A row in `ai_blocks` (`all`, `game:<gameType>` or `user:<id>`) switches AI off with no deploy.

`ctx.ai` exists only in content actions. Session actions hold the session locked, and a model call takes seconds.

**In the browser,** `aiStatus(gameType)` from `@/lib/game-sdk/client` returns `{ available, remaining }`. Hide AI controls when `available` is false: there's no key on the server, AI is switched off, or the viewer is a guest. Use `remaining[use]` to show what's left today.

**In tests,** `createTestContent(plugin, { ai: { suggestTitle: [{ title: "Soup Day" }] } })` runs content actions with scripted replies, under the same declared limits and output check. `t.act(name, input)` calls an action, and `t.aiCalls` lists what was sent. Tests never reach a model.

---

## Testing

`@/lib/game-sdk/testing` runs a game in memory: no browser, no HTTP, and no database (the dev database is production, so this matters). Actions pass through the same access and input checks as the real route, and the same transaction rules — a crash rolls the action back, a `GameError` keeps what was written before it, and broadcasts and pushes are recorded only when an action commits.

`games/hot-take/plugin.test.ts`:

```ts
import { expect, it } from "vitest";
import { createTestSession } from "@/lib/game-sdk/testing";
import { plugin } from "./plugin";

it("ends once everyone has voted", async () => {
  const t = createTestSession(plugin, { players: ["ann", "bob"], content: { statement: "Pineapple belongs on pizza" } });
  await t.start();
  await t.as("ann").act("vote", { vote: "agree" });
  await expect(t.as("ann").act("vote", { vote: "agree" })).rejects.toThrow("You already voted");
  await t.as("bob").act("vote", { vote: "disagree" });

  expect(t.status()).toBe("completed");
  expect(t.notifications).toHaveLength(1);
});
```

The harness gives you:

| | |
|---|---|
| `t.start()` | The host starts the game |
| `t.as(id).act(name, input)` | Calls a session action as that player (`null` for a logged-out spectator). Rejects with the same `GameError`, status included, that the route would answer with |
| `t.as(id).playProps()`, `t.result()` | What `buildPlayProps` and `buildResult` return |
| `t.state()`, `t.status()`, `t.currentPlayerId()` | What's stored now |
| `t.broadcasts`, `t.notifications` | Everything committed actions sent |
| `t.setState(data)`, `t.withContext(id, fn)` | Simulate another request's write; run code against a real context |

Test files are `*.test.ts` next to the code, and `npm test` runs them; CI does too. Only test files may import `@/lib/game-sdk/testing`.

---

## Checklist

- [ ] `gameType` is lowercase letters, digits and underscores, and never changes once games exist
- [ ] `npm run games:sync` run and `lib/games/registry.ts` committed
- [ ] `npm run lint` is clean — no restricted imports
- [ ] `npm test` passes, with tests for your game's action flow
- [ ] Every action has the tightest `auth` / `access` that works, and an `input` schema
- [ ] AI goes through declared `ai` uses with the smallest `output`, input and per-day limits that work
- [ ] Nothing secret in `buildPlayProps`, in a `"viewer"` action, or in a broadcast — spectators receive all three
- [ ] Every `state.update` passes the `expectedVersion` it read
- [ ] The play screen works for a spectator (`currentUserId === ""`)
- [ ] The PR touches only `games/<name>/`, the registry, and (if needed) `package.json` / `package-lock.json`

## Common mistakes

- **Trusting the client.** Validate everything in the handler: whose turn it is, whether the move is legal, whether they've already acted. `access: "player"` tells you they are *a* player, not that it is *their* turn.
- **Leaking through props.** `buildPlayProps` output is serialized into the page for everyone who can open it.
- **Updating state without a version.** Read, then `update(..., { expectedVersion })` with the version you read.
- **Writing, then throwing a `GameError` you meant as a rollback.** A `GameError` keeps earlier writes. Do your checks first, then write.
- **Reaching into core.** If you want something the SDK doesn't have, that's a core PR — not a deep import.
