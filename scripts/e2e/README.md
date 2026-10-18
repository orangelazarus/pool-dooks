# End-to-end checks

Scripts that drive real browsers (Playwright) through the app, for checking a
change works before and after a deploy. They aren't part of `npm test` or CI:
they need a running server, real Supabase, and real guest accounts.

> **They run against production data.** `.env.local` points at the production
> database (there is no staging one), and so does a local server. Everything
> the scripts create is named so `cleanup.mjs` can find it. Run it afterwards.

## Setup

```bash
npm install                                  # playwright-core is a dev dependency
npx playwright-core install chromium         # once; or set CHROMIUM_PATH
npm run build && PORT=3000 npm start         # in another terminal
```

Use **port 3000** locally: the lobby calls back to `NEXT_PUBLIC_APP_URL` when
someone joins. To check production instead, set `BASE=https://pooldooks.com`.

## The scripts

| Script | Checks | Guest sign-ups |
|---|---|---|
| `gameplay.mjs` | Lobby join, leave, rejoin and remove; reopening the invite mid-game; leaving mid-game in Subterfuge and Acrophobia. All of it depends on live updates. | 8 |
| `security.mjs` | Who may listen and send on a session's live channel; private stories stay private; GET actions answer. | 4 |
| `auth.mjs` | Login by username or email without leaking the email; profile creation tied to the caller; Supabase REST closed on app tables. | 0 (uses throwaway email accounts) |
| `removal-race.mjs` | A player removed the instant their lobby appears is still told (#35). | 2 |
| `editor.mjs` | The Pool Dooks editor loads and takes typing. | 1 |
| `cleanup.mjs` | Lists what the scripts left behind; `--delete` removes it. | – |

Each prints `PASS`/`FAIL` lines and a tally, and exits non-zero on any failure.
A run that stops on an error screenshots its open pages into `shots/`.
`TRACE=<role>` on `gameplay.mjs` logs one player's live-channel frames with
timings (for example `TRACE=D`); that is how the join races were found.

## The guest sign-up limit

Every test browser signs up a new guest, and Supabase allows about **30 guest
sign-ups an hour per IP**. A full pass (`gameplay` + `security`, locally and
then on production) uses 24. When the limit is hit, guest pages just stall and
scripts time out at the guest step, which looks like an app bug: check for a
**429** from `/auth/v1/signup` first, then wait for the hour to roll over.

## Cleaning up

```bash
node scripts/e2e/cleanup.mjs            # dry run
node scripts/e2e/cleanup.mjs --delete
```

It only removes:
- **guests:** named in the scripts' format (`e2e` + a role + a run tag), created in the last 24 hours (`HOURS` changes this), with an anonymous login
- **sessions:** only those whose players are all such guests
- **content:** anything those guests authored
- **throwaway accounts:** `e2e-…@example.com` accounts a crashed run didn't remove

Public test sessions it deletes also drop off the home page.
