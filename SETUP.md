# Pool Dooks — Setup Guide

## 1. Create a Supabase Project

Go to [supabase.com](https://supabase.com) → New Project.

Copy your project's **URL**, **anon key**, and **service role key** from:
Project Settings → API

Copy your **database connection string** (with pgBouncer for pooling) from:
Project Settings → Database → Connection String → Transaction mode

## 2. Configure Environment Variables

Create `.env.local` in the project root with your actual values:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-us-east-1.pooler.supabase.com:6543/postgres
# Optional: Pool Dooks' AI features (hidden without it)
ANTHROPIC_API_KEY=sk-ant-...
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## 3. Generate VAPID Keys for Push Notifications

```bash
npm run push:generate-keys
```

Add the output to `.env.local`:
```env
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<public key>
VAPID_PRIVATE_KEY=<private key>
VAPID_SUBJECT=mailto:you@example.com
```

## 4. Create the Database Schema

For a **new, empty** database:

```bash
npm run db:push
```

This creates all tables in your Supabase Postgres database. Games have no tables of their own: they store everything in the generic `game_content` and `game_state` tables.

Never run `db:push` against a database that already has data — the migration snapshot is stale and it can propose destructive changes. Later schema changes are hand-written, numbered SQL files in `drizzle/`, applied through the Supabase SQL Editor **before** the code that needs them is deployed.

## 5. Lock Down Supabase's REST API

Supabase exposes every table in the `public` schema through its REST API, and by default its browser roles (`anon`, `authenticated`) get full privileges on new tables. This app never uses that API: browsers talk to Supabase only for Auth and Realtime, and every read and write goes through the app's API routes, which reach Postgres through `DATABASE_URL`.

So the REST API is closed on every app table. Run `drizzle/0015_lock_down_rest.sql` in the Supabase SQL Editor. It:

- revokes all privileges on the `public` tables and sequences from `anon` and `authenticated`, and stops tables created later from being granted to them
- drops any policies for those roles
- leaves row-level security **on** for every table with **no** policies, so even a grant added by mistake later exposes nothing

Don't add RLS policies for browser roles. If a feature seems to need one, it needs an API route instead.

The app's own database role must be able to reach every table without policies: give it direct grants and `BYPASSRLS` (`ALTER ROLE <app_role> BYPASSRLS`), or use the tables' owner. It must not be a member of `anon` or `authenticated`.

## 6. Private Realtime Channels

Live updates use Realtime **broadcast** on private channels (`session:<code>`, `chat:<code>`), not database change feeds, so there's nothing to switch on per table.

Run `drizzle/0014_private_realtime.sql` in the Supabase SQL Editor. It adds the one policy that decides who may listen: a session's active players, or anyone if the session is public. There is deliberately no policy for sending, so only the server can broadcast. It does so with `SUPABASE_SERVICE_ROLE_KEY`, which must therefore be set wherever the app runs. Without the policy, every browser's subscription is refused and nothing updates live.

## 7. Enable Anonymous Sign-Ins

In Supabase Dashboard → Authentication → Sign In / Providers → enable **Anonymous sign-ins**.

Guest play depends on this: a visitor without an account picks a name and gets an anonymous account.

## 8. Run the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

Use port 3000: the lobby calls back to `NEXT_PUBLIC_APP_URL` when someone joins, so a different port leaves new players stuck in a redirect loop.

`npm run dev` and `npm run build` first run `npm run games:sync`, which regenerates `lib/games/registry.ts` from the plugins in `games/`.

## PWA Icons

The icons live in `/public/icons/`:
- `icon-192.png`, `icon-512.png` — the installable app (`manifest.json`)
- `favicon-32.png`, `favicon-96.png` — browser tabs
- `apple-touch-icon.png` — iOS home screen

## Project Structure

```
app/          Next.js App Router pages + API routes
games/        One self-contained plugin per game (pool-dooks, guess-the-number, farkle, chess, subterfuge, acrophobia)
components/   Shared React components (session, layout, ui)
hooks/        Custom React hooks (useSession, useSessionChat, useGameState, usePushNotifications)
lib/          Core logic (db schema, game SDK, game registry, session access, auth, push, realtime)
drizzle/      Numbered SQL migrations
scripts/      sync-games.mjs (generates the game registry), check-pr-boundary.mjs (CI: games and core in separate PRs)
public/       Static assets (manifest.json, sw.js, icons)
proxy.ts      Auth gate: what logged-out visitors can reach
```

See [README.md](README.md) for a fuller breakdown and [docs/creating-a-game.md](docs/creating-a-game.md) for adding a game.
