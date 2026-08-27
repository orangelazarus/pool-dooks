@AGENTS.md

# Deployment

`pooldooks.com` is **not** a Vercel/Netlify project. It runs on a self-managed
Hetzner VPS at `178.156.199.112`, behind Caddy reverse-proxying a Next.js Node
process. SSH key is `~/.ssh/hetzner` (no `~/.ssh/config` entry — pass `-i`).

**The deploy procedure is not yet captured in this repo.** Still unknown: the SSH
login user, the app directory on the box, whether it deploys by `git pull` or
rsync, and what supervises the process (systemd vs pm2).

Because there is no deploy config here, it's tempting to assume push-to-deploy.
Don't. Ask before deploying, and once the steps are confirmed, record them in
`scripts/deploy.sh` and replace this section.

# Renamed from madlibs

The project was renamed `madlibs` -> `pooldooks`. These still say `madlibs` **on
purpose** — do not "fix" them:

- `DATABASE_URL` uses the Supabase DB role `madlibs_app`; `VAPID_SUBJECT` is
  `mailto:admin@madlibs.app`. Both are external identifiers — changing the strings
  here just breaks auth.
- "Mad libs" in `README.md`, `SETUP.md`, and `games/pool-dooks/ai/prompts.ts`
  describes the game *genre*; the AI prompts depend on it.
