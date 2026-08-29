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

# Database migrations

Queries use `db.select().from(table)`, which names every column in the Drizzle
schema — so a newly added column breaks **all** queries against that table until
it exists in Postgres. Always apply the migration before deploying the code.

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
  describes the game *genre*; the AI prompts depend on it.
