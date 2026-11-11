# Pool Dooks

A multiplayer game platform. Play together in real time — fill in the blanks, roll dice, play chess, bluff at trivia, riff on acronyms, spin for letters, or build your own game.

**Live at [pooldooks.com](https://pooldooks.com)** · source on [GitHub](https://github.com/orangelazarus/pool-dooks)

---

## Games

### Pool Dooks
Mad libs-style fill-in-the-blank stories. Players take turns filling in blanks without seeing the story — then everyone reads the ridiculous result together. Stories are AI-generated or created by hand with a rich editor. 1–16 players.

### Guess the Number
The host picks a secret number range. Everyone submits a guess. Closest to the secret number wins. 2–16 players.

### Farkle
Roll six dice, set aside the scoring ones, and decide whether to bank or push your luck — bust and the turn's points are gone. First to the target score wins. Two rulesets: **Original** (standard Farkle) and **KCD** (the tavern dice game from Kingdom Come: Deliverance, with its straights and doubling multiples). 2–6 players.

### Chess
Standard two-player chess with full rules, including castling, en passant, promotion, and automatic draws. The host picks White, Black or Random, and plays untimed or with 5, 10 or 30 minutes per side. Either player can resign or offer a draw.

### Subterfuge
A trivia bluffing game. Everyone writes a lie convincing enough to pass for the answer to an obscure question, then tries to pick the truth from among them. Points for finding it, and for every friend your lie fools. 2–8 players.

### Acrophobia
Turn a random acronym into the funniest phrase you can, then vote for your favourite. The first players to the target meet in a face-off judged by everyone else. 3–12 players.

### Discus of Wealth
A Wheel of Fortune-style word puzzle. Spin the discus for a prize (or Bankrupt, or Lose a Turn), call consonants, buy vowels, and solve before your friends do. Three to five puzzles, optionally followed by a bonus round for the leader. 2–6 players.

---

## How It Works

- **Pick a game** from the home page and set it up
- **Invite people or open it up** — share the 6-character code for a private game, or mark the game **public** so it's listed on the home page for anyone to join. A public game that hasn't started within 15 minutes is closed
- **No account needed** — visitors pick a name and play as a guest, or sign in to keep a profile
- **Play in real time** — Supabase Realtime keeps everyone in sync, with push notifications when it's your turn
- **Chat** — every session has a chat for its players
- **Come and go** — players can leave a lobby (and come back through the invite), and the host can remove someone, who can't rejoin. Games that can carry on without a player let people leave mid-game too
- **Watch** — public games can be watched by anyone once they've started; when a public lobby is full, extra arrivals become spectators
- **See the reveal**, then hit Play Again to take the same group into another game
- **Look back** — every game's page lists recently finished games (yours, and public ones), each with **See result** and **Play again** with the same rules

Private games are for their players only while in progress. AI features (Pool Dooks' story generation, adding blanks, and page scanning) need a signed-up account, not a guest one, and are limited per person per day.

### Security model

- **One way in.** Browsers never touch the database. Every read and write goes through the app's API routes, which check who is asking, and reach Postgres as the app's own role. Supabase's REST API is closed on every table (no privileges or policies for its browser roles); see [SETUP.md](SETUP.md).
- **Private live updates.** Realtime channels are private: only a session's players (or anyone, for a public game) may listen, and only the server may send, so browsers can trust what arrives.
- **Games can't reach past the SDK.** They get a context scoped to their own game and session; see [Plugin Architecture](#plugin-architecture).
- **AI is metered by core.** Games never call a model or see the API key. They declare each AI use, and core runs it: signed-up accounts only, replies forced into the declared shape (so a feature can't be used as a general chatbot), and daily limits per person, per network, per game and for the whole site. Every call is logged; see [AI](#ai).

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Auth + Realtime | Supabase |
| Database | Postgres via Drizzle ORM |
| UI | shadcn/ui + Tailwind CSS |
| Rich editor | Tiptap |
| Chess rules | chess.js |
| AI | Claude (Anthropic), through core's metered AI service |
| Push notifications | Web Push (VAPID) |
| Hosting | Hetzner VPS, PM2, Caddy |

---

## Plugin Architecture

Games are plugins. Each one lives entirely inside `games/<name>/`, and adding one needs **no change to core code and no SQL**. Deleting the directory removes the game.

A game is a `defineGame()` definition from the game SDK (`lib/game-sdk`):

```ts
export const plugin = defineGame<Content, State>({
  gameType: "hot_take",
  displayName: "Hot Take",
  description: "…",
  minPlayers: 2,
  maxPlayers: 16,

  start(ctx) { … },             // host starts the game
  buildPlayProps(ctx) { … },    // props for the play screen
  buildResult(ctx) { … },       // props for the reveal

  ai: { suggest: { tier: "fast", maxInputChars: 500, maxOutputTokens: 300, output: SuggestionSchema, perUserPerDay: 10 } },
  contentActions: { create: { auth: "user", input: CreateSchema, handler } },
  sessionActions: { vote: { access: "player", input: VoteSchema, handler } },

  PlayComponent, RevealComponent, BrowsePage,
});
```

**Core does the security.** Before a game's handler runs, core has authenticated the caller, checked the action's access level, checked the session belongs to that game and that the caller may see it, and validated the input; a session action then runs in one transaction that locks the session and checks access again, and GET actions are read-only. Handlers get a context scoped to one game and one session — content (never someone else's private rows), version-checked state, turn, deadlines, broadcast, push, and the game's declared AI uses — and nothing else: the database, auth, push and AI clients are not exposed to games.

**The boundary is enforced.** ESLint stops game code importing anything from core except the SDK, the UI components and `cn`, and stops it importing a model SDK, reading `process.env` or calling `fetch`. CI fails a pull request that changes a game directory together with core code, so a game that needs something new from core gets it as a separate PR first.

**Storage is generic.** Games keep their content and live state as JSON in two core-owned tables (`game_content`, `game_state`), validated in code with Zod.

**Core provides the shared pages.** Session setup, the lobby, chat, spectating, the reveal, Play Again, and the list of recently finished games under each game's page all come from core; a game supplies its play screen, reveal and browse page.

`lib/games/registry.ts` is generated by `npm run games:sync`, which scans `games/*/plugin.ts`. It runs automatically before `dev` and `build`.

See [docs/creating-a-game.md](docs/creating-a-game.md) for a full guide with a worked example.

---

## AI

The only model calls are in `lib/ai/service.ts`. A game declares each use in `defineGame({ ai })` — a tier (`fast` or `smart`; core picks the model), input and output limits, whether it takes an image, a Zod object for the reply, and calls per person per day — and calls it with `ctx.ai.run` from a content action. See [Using AI](docs/creating-a-game.md#using-ai).

Core checks, before anything is sent:

| Limit | Default |
|---|---|
| Who | Signed-up accounts only |
| Per account, all games | 20 calls a day; 3 for an account under a day old |
| Per network (IP) | 40 calls a day |
| Per game | $2 a day |
| Whole site | $5 a day |
| At once | One call per person |

The defaults are constants in `lib/ai/limits.ts`; models and prices are in `lib/ai/models.ts`. Every call and refusal is logged in the `ai_usage` table, and `node scripts/ai-usage.mjs` reports cost by day, game and user, plus who keeps hitting limits and networks with several accounts. To switch AI off without a deploy, add a row to `ai_blocks` in the SQL Editor — scope `all`, `game:<gameType>` or `user:<profile id>`. Set a monthly spend limit in the Anthropic console as a backstop.

---

## Linked Blanks

Pool Dooks supports linked blanks — a single blank that appears multiple times in the story but is answered only once. When a character name or recurring concept is filled in, every occurrence updates.

- **In the editor** — use "Reuse Blank" to insert a linked copy of any existing blank
- **On paste** — same non-generic label used multiple times → automatically linked
- **AI generation** — the model is prompted to reuse token IDs for recurring concepts

---

## Local Setup

### Prerequisites

- Node.js 20+
- A [Supabase](https://supabase.com) project
- Optionally, an [Anthropic](https://console.anthropic.com) API key. Pool Dooks uses it to generate stories, add blanks to pasted text and scan printed pages; without it those features are hidden and everything else works. Make sure it's the whole key: the console's dialog wraps it over two lines.

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Create `.env.local` with:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres.[ref]:[password]@pooler.supabase.com:6543/postgres
# Optional: Pool Dooks' AI features (hidden without it)
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:you@example.com
```

Generate VAPID keys:

```bash
npm run push:generate-keys
```

### 3. Create the database schema

For a **new, empty** database:

```bash
npm run db:push
```

Never run `db:push` against a database that already has data — the migration snapshot is stale and it can propose destructive changes. Schema changes after the initial setup are hand-written, numbered SQL files in `drizzle/`, applied through the Supabase SQL Editor **before** the code that needs them is deployed.

### 4. Configure Supabase

In the Supabase dashboard:
- **SQL Editor** — run `drizzle/0014_private_realtime.sql` (who may listen to live updates) and `drizzle/0015_lock_down_rest.sql` (closes the REST API on the app's tables). `db:push` creates tables only, so these are needed on a fresh database too. Details in [SETUP.md](SETUP.md)
- **Auth** — enable anonymous sign-ins (for guest play)

Realtime needs no per-table setting: the app uses private broadcast channels, not database change feeds.

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Use port 3000: the lobby calls back to `NEXT_PUBLIC_APP_URL` when someone joins.

---

## Testing

```bash
npm test
```

Runs the Vitest suite: the game SDK's own tests and each game's `plugin.test.ts`. Games are tested with `@/lib/game-sdk/testing`, which runs a game in memory — no browser, HTTP or database — through the same access, input and transaction rules as production. See [Testing in the game guide](docs/creating-a-game.md#testing). CI runs lint, the tests and the core/game boundary check on every pull request.

Games that use AI are tested with `createTestContent`, which runs content actions with scripted AI replies under the same declared limits, so tests never call a model.

Browser checks (Playwright) live in `scripts/e2e/` — see its [README](scripts/e2e/README.md). They aren't part of `npm test`: `.env.local` points at the production database (there is no staging one), so a local server uses real data, and everything the scripts create must be cleaned up with `scripts/e2e/cleanup.mjs`. Supabase also limits guest sign-ups to about 30 an hour per IP, which a few automated multi-player runs use up.

---

## Deployment

Production runs on a Hetzner VPS behind Caddy, supervised by PM2, with a firewall that only admits SSH and web traffic. The app is built locally and shipped as a release that is smoke-tested and then swapped in — never built on the server. The full procedure is in [CLAUDE.md](CLAUDE.md).

---

## Project Structure

```
app/
  (app)/
    home/                   Game launcher + open public games
    games/[gameType]/       A game's browse, create and library pages (from its plugin), plus recently finished games
    sessions/
      new/                  Create or join a session
      [code]/               Lobby, play (and watch), reveal
    profile/
  (auth)/                   Login, signup, guest name
  api/
    sessions/               Session lifecycle (create, join, leave, kick, start, answer,
                            chat, reveal, result, rematch)
    games/[gameType]/       Routed to the plugin's handleRequest: content and session actions, AI status
    game-content/           Generic plugin metadata
    auth/                   Sign-in, profile creation, current user
    push/                   Web push subscription

games/                      One self-contained plugin per game, built on lib/game-sdk
  pool-dooks/               Tiptap editor, AI prompts
  guess-the-number/
  farkle/                   Scoring engine (both rulesets)
  chess/                    Rules helpers, clock
  subterfuge/               Question bank, scoring
  acrophobia/               Acronyms, categories, face-off
  discus-of-wealth/         Discus, puzzles, bonus round

components/
  session/                  Lobby, GuestJoin, PlayMenu, SessionChat, RematchPrompt, RecentGames, ShareCode, SessionNotice
  layout/                   Nav, Footer, Logo + Wordmark
  ui/                       shadcn/ui components

lib/
  game-sdk/                 The only core API games may use: defineGame, contexts, storage, client helpers, test harness
  ai/                       The AI service: limits, models and prices, the metered call
  games/
    types.ts                Engine-facing plugin shape (built by defineGame)
    registry.ts             Generated plugin registry
  sessions/                 Viewer access, leaving, chat, expiry, public listing, finished-game history
  auth/                     Guest sign-in
  db/                       Drizzle schema + client (core tables)
  realtime/                 Event types + the server's private-channel sender
  push/                     VAPID + send helpers
  supabase/                 Server and browser clients

hooks/
  useSession.ts             The session's private Realtime channel
  useSessionChat.ts         Session chat: history, live updates, sending
  useGameState.ts           Client-side game state reducer
  usePushNotifications.ts   Push notification management

drizzle/                    Numbered SQL migrations
scripts/
  sync-games.mjs            Generates the plugin registry
  check-pr-boundary.mjs     CI check: game and core changes go in separate PRs
  ai-usage.mjs              AI cost and usage report from the ai_usage ledger
  e2e/                      Browser checks against a running server, and their cleanup
proxy.ts                    Auth gate: what logged-out visitors can reach
```
