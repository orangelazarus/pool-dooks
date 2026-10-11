@AGENTS.md

# Deployment

`pooldooks.com` is **not** a Vercel/Netlify project. It runs on a self-managed
Hetzner VPS at `178.156.199.112` (login `root`, key `~/.ssh/hetzner`, no
`~/.ssh/config` entry — pass `-i`). Caddy reverse-proxies `localhost:3000`.
The app is at `/var/www/madlibs`, which is **not a git repo** — there is no
`git pull` deploy. pm2 supervises it: process `madlibs`, running `npm start`.

**Never run `next build` on the server.** It has 1.9 GB RAM and no swap; building
there OOM-kills the build and takes the site down. Build locally and ship `.next`.

Deploy is a release swap, so a bad build never reaches users:

1. Back up: `tar czf /root/madlibs-backup-$(date +%F-%H%M%S).tar.gz --exclude=node_modules --exclude=.next -C /var/www madlibs`
2. Ship the committed tree to a fresh dir so deleted files can't linger:
   `git archive --format=tar HEAD | ssh ... 'tar x -C /var/www/madlibs-next'`
3. Copy the **server's** `.env` / `.env.local` into it — never ship local ones
4. `npm ci --include=dev` in `/var/www/madlibs-next` (installing is fine; building is not)
5. Build locally, ship `.next` minus `cache`:
   `tar czf - --exclude=./cache -C .next . | ssh ... 'tar xzf - -C /var/www/madlibs-next/.next'`
6. Smoke-test on `PORT=3100` while :3000 still serves the old release
7. `mv` swap, `pm2 restart madlibs --update-env`, and swap back if `/login` isn't 200

Kill the smoke instance by PID from `ss -ltnp`. `pkill -f "PORT=3100"` matches the
deploy script's own command line and kills it mid-run.

# Games and core are separate

Games are plugins under `games/<name>/`, built with `defineGame()` from
`lib/game-sdk`. Two rules, both enforced:

- **Game code imports from core only** `@/lib/game-sdk`, `@/lib/game-sdk/client`,
  `@/components/ui/*` and `@/lib/utils` — never the database, Supabase or push
  directly. ESLint (`no-restricted-imports`) fails otherwise.
- **A PR changes a game or core, not both.** If a game needs something new from
  the SDK, land that as its own core PR first. CI runs
  `scripts/check-pr-boundary.mjs`; only `lib/games/registry.ts` (generated — run
  `npm run games:sync` and commit it) and `package.json` / `package-lock.json`
  may accompany a game change.

Games own no tables. Their content and live state are JSON rows in core's
`game_content` and `game_state`, so adding or changing a game needs no SQL.
See `docs/creating-a-game.md`.

# Database migrations

Queries use `db.select().from(table)`, which names every column in the Drizzle
schema — so a newly added column breaks **all** queries against that table until
it exists in Postgres. Always apply the migration before deploying the code.

This applies to core tables only (`lib/db/schema.ts`); games have none.

Migrations are hand-written numbered SQL in `drizzle/`. `drizzle/meta/_journal.json`
only tracks `0000`, so the snapshot is stale and **`npm run db:push` can propose
destructive changes against production** — don't use it. Apply the explicit
`ALTER TABLE` via the Supabase SQL Editor instead. There is no staging database;
`.env.local`'s `DATABASE_URL` is production.

# Renamed from madlibs

The project was renamed `madlibs` -> `pooldooks`. These still say `madlibs` **on
purpose** — do not "fix" them:

- `DATABASE_URL` uses the Supabase DB role `madlibs_app`; `VAPID_SUBJECT` is
  `mailto:admin@madlibs.app`. Both are external identifiers — changing the strings
  here just breaks auth.
- "Mad libs" in `README.md`, `SETUP.md`, and `games/pool-dooks/ai/prompts.ts`
  describes the game *genre*; the AI prompts depend on it. The same goes for the
  enhance and scan prompts in `games/pool-dooks/plugin.ts`.
