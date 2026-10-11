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

This creates all tables in your Supabase Postgres database, including each game's own tables (`games/*/schema.ts`).

Never run `db:push` against a database that already has data — the migration snapshot is stale and it can propose destructive changes. Later schema changes are hand-written, numbered SQL files in `drizzle/`, applied through the Supabase SQL Editor **before** the code that needs them is deployed.

## 5. Configure Row-Level Security (RLS)

Run these SQL policies in Supabase SQL Editor:

```sql
-- Enable RLS on all tables
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_dooks ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_players ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Profiles: users can read all, update their own
CREATE POLICY "profiles_select" ON profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_insert" ON profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE TO authenticated USING (id = auth.uid());

-- Mad libs: public ones readable by all, authors manage their own
CREATE POLICY "pool_dooks_select" ON pool_dooks FOR SELECT USING (is_public = true OR author_id = auth.uid());
CREATE POLICY "pool_dooks_insert" ON pool_dooks FOR INSERT TO authenticated WITH CHECK (author_id = auth.uid());
CREATE POLICY "pool_dooks_update" ON pool_dooks FOR UPDATE TO authenticated USING (author_id = auth.uid());
CREATE POLICY "pool_dooks_delete" ON pool_dooks FOR DELETE TO authenticated USING (author_id = auth.uid());

-- Sessions: readable by all authenticated, only host updates
CREATE POLICY "sessions_select" ON sessions FOR SELECT TO authenticated USING (true);
CREATE POLICY "sessions_insert" ON sessions FOR INSERT TO authenticated WITH CHECK (host_id = auth.uid());
CREATE POLICY "sessions_update" ON sessions FOR UPDATE TO authenticated USING (host_id = auth.uid());

-- Session players: readable by session members
CREATE POLICY "session_players_select" ON session_players FOR SELECT TO authenticated USING (true);
CREATE POLICY "session_players_insert" ON session_players FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());
CREATE POLICY "session_players_update" ON session_players FOR UPDATE TO authenticated USING (player_id = auth.uid());

-- Answers: insert own, select only when session completed or own row
CREATE POLICY "answers_insert" ON answers FOR INSERT TO authenticated WITH CHECK (player_id = auth.uid());
CREATE POLICY "answers_select" ON answers FOR SELECT TO authenticated USING (
  player_id = auth.uid() OR
  EXISTS (SELECT 1 FROM sessions s WHERE s.id = session_id AND s.status = 'completed')
);

-- Push subscriptions: users manage their own
CREATE POLICY "push_subs_all" ON push_subscriptions FOR ALL TO authenticated USING (user_id = auth.uid());

-- Service role bypass (for server-side operations)
CREATE POLICY "service_role_bypass" ON answers FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_bypass_sessions" ON sessions FOR ALL TO service_role USING (true);
```

Then lock down the game tables the same way, by running the RLS statements in:
- `drizzle/0005_farkle_rls.sql` — `farkle_games`, `farkle_turns`
- `drizzle/0006_number_games_rls.sql` — `number_games`
- `drizzle/0007_chess.sql` (the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` and `CREATE POLICY` lines at the end) — `chess_games`, `chess_states`

Every table in the `public` schema is exposed through Supabase's REST API, so a table without RLS is readable and writable by anyone holding the anon key.

## 6. Enable Realtime in Supabase

In Supabase Dashboard → Realtime → enable Realtime for:
- `sessions` table
- `session_players` table

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

Add icons to `/public/icons/`:
- `icon-192.png` — 192×192px
- `icon-512.png` — 512×512px

## Project Structure

```
app/          Next.js App Router pages + API routes
games/        One self-contained directory per game (pool-dooks, guess-the-number, farkle, chess)
components/   Shared React components (session, layout, ui)
hooks/        Custom React hooks (useSession, useGameState, usePushNotifications)
lib/          Core logic (db schema, game registry, session access, auth, push, realtime)
drizzle/      Numbered SQL migrations
scripts/      sync-games.mjs — generates the game registry
public/       Static assets (manifest.json, sw.js, icons)
proxy.ts      Auth gate: what logged-out visitors can reach
```

See [README.md](README.md) for a fuller breakdown and [docs/creating-a-game.md](docs/creating-a-game.md) for adding a game.
