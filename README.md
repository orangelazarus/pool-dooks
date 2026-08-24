# Pool Dooks

A multiplayer party game platform. Play together in real time — fill in the blanks, guess the number, or build your own game.

**Live at [pooldooks.com](https://pooldooks.com)**

---

## Games

### Pool Dooks
Mad libs-style fill-in-the-blank stories. Players take turns filling in blanks without seeing the story — then everyone reads the ridiculous result together. Stories are AI-generated or created by hand with a rich editor.

### Guess the Number
The host picks a secret number range. Everyone submits a guess. Closest to the secret number wins.

---

## How It Works

- **Create or pick a game** — browse the library or generate a story with AI
- **Share a 6-character code** with friends — they join as guests (no account needed) or sign in
- **Take turns in real time** — Supabase Realtime keeps everyone in sync
- **See the reveal** — Pool Dooks reads the completed story; Guess the Number shows the secret and rankings

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router) |
| Auth + Realtime | Supabase |
| Database | Postgres via Drizzle ORM |
| UI | shadcn/ui + Tailwind CSS |
| Rich editor | Tiptap |
| AI generation | Claude (Anthropic) |
| Push notifications | Web Push (VAPID) |
| Hosting | Hetzner VPS, PM2, Caddy |

---

## Plugin Architecture

Games are plugins. Adding a new game means implementing one interface and registering it — no changes to the core session engine.

```ts
interface GamePlugin {
  gameType: string;
  displayName: string;
  description: string;
  browsePath: string;
  minPlayers: number;
  maxPlayers: number;
  supportsRandomize: boolean;

  start(session, players, randomize): Promise<{ tokenOrder, firstPlayerId? }>
  getAnswerHints(ctx): Promise<{ nextTokenLabel? }>
  buildResult(session, answers): Promise<Record<string, unknown>>
  buildPlayProps(session, players): Promise<Record<string, unknown>>
  getLobbyMeta?(session): Promise<{ subtitle }>
  getContentMeta(gameContentId): Promise<{ title }>

  PlayComponent: React.ComponentType
  RevealComponent: React.ComponentType
}
```

Register in `lib/games/registry.ts` — the game appears on the home page automatically.

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
- An [Anthropic](https://console.anthropic.com) API key

### 1. Install dependencies

```bash
npm install
```

### 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres.[ref]:[password]@pooler.supabase.com:6543/postgres
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

### 3. Push the database schema

```bash
npm run db:push
```

### 4. Configure Supabase

In the Supabase dashboard:
- **SQL Editor** — run the RLS policies from `SETUP.md`
- **Realtime** — enable for the `sessions` and `session_players` tables
- **Auth** — enable anonymous sign-ins (for guest play)

### 5. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
app/
  (app)/
    home/                 Game launcher
    games/
      pool-dooks/         Pool Dooks browse + filter
      guess-the-number/   Guess the Number create + history
    sessions/
      new/                Create or join a session
      [code]/             Lobby, play, reveal
    create/               Pool Dook editor
  api/
    sessions/             Session lifecycle (create, join, start, answer, result)
    pool-dooks/           CRUD + AI import
    number-games/         Guess the Number content
    game-content/         Generic plugin metadata
    ai/                   Generate, enhance, scan image
    push/                 Web push subscription

components/
  editor/                 Tiptap editor + toolbar + import dialog
  session/                Lobby, GameBoard, RevealDisplay, GuestJoin
  games/
    guess-the-number/     NumberGameBoard, NumberGameReveal
  pool-dook/              Cards, theme filter

lib/
  games/
    types.ts              GamePlugin interface
    registry.ts           Plugin registry
    pool-dooks/           Pool Dooks plugin
    guess-the-number/     Guess the Number plugin
  db/                     Drizzle schema + client
  ai/                     Prompts + generation
  editor/                 Serialize / deserialize editor content
  realtime/               Event types + channel helpers
  push/                   VAPID + send helpers

hooks/
  useSession.ts           Supabase Realtime subscription
  useGameState.ts         Client-side game state reducer
  usePushNotifications.ts Push notification management
```
