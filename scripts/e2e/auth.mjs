#!/usr/bin/env node
// Sign-in and data-access probes. Uses throwaway email accounts made with the
// admin API (and deleted at the end), so no guest sign-ups are spent.
//
//   - login by username or email works, sets the session, never returns the email
//   - every failure gets the same answer (no telling which accounts exist)
//   - the old email-lookup endpoint is gone
//   - a profile can only be made for your own, brand-new account
//   - Supabase's REST API is closed on the app's tables (migration 0015)
//
//   node scripts/e2e/auth.mjs
//   BASE=https://pooldooks.com node scripts/e2e/auth.mjs
import { BASE, anon, checker, closeDb, db, env, launch, tag, throwawayAccount } from "./lib.mjs";

const { check, fail, done } = checker();
const post = (path, body, headers = {}) =>
  fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

const account = await throwawayAccount();
try {
  // ── Login ─────────────────────────────────────────────────────────────────
  const byName = await post("/api/auth/login", { identifier: account.username, password: account.password });
  const cookies = byName.headers.getSetCookie?.() ?? [];
  check("login by username works and sets the session cookie", byName.status === 200 && cookies.some((c) => c.startsWith("sb-")), `${byName.status}`);
  check("…without returning the email", !(await byName.text()).includes("@"));
  check("login by email works", (await post("/api/auth/login", { identifier: account.email, password: account.password })).status === 200);
  const wrong = await post("/api/auth/login", { identifier: account.username, password: "nope" });
  const nobody = await post("/api/auth/login", { identifier: `nobody${tag}`, password: "nope" });
  const [w, n] = [await wrong.json(), await nobody.json()];
  check("a wrong password and an unknown user get the same answer", wrong.status === 401 && nobody.status === 401 && w.error === n.error, w.error);
  check("the email-lookup endpoint is gone", (await fetch(`${BASE}/api/auth/login-lookup?username=${account.username}`)).status === 404);

  // ── Profiles ──────────────────────────────────────────────────────────────
  const session = cookies.map((c) => c.split(";")[0]).join("; ");
  const squat = `e2eQ${tag}`;
  check("no profile for a made-up id", (await post("/api/auth/profile", { userId: crypto.randomUUID(), username: squat })).status === 403);
  check("no second profile for someone else's account", (await post("/api/auth/profile", { userId: account.id, username: squat })).status === 403);
  check(
    "a signed-in user can't make one for another id",
    (await post("/api/auth/profile", { userId: crypto.randomUUID(), username: squat }, { cookie: session })).status === 403
  );
  const { rows } = await db().query("select count(*)::int n from profiles where username = $1", [squat]);
  check("nothing was squatted", rows[0].n === 0);

  // ── Sign in through the real page ─────────────────────────────────────────
  const browser = await launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const answers = [];
    page.on("response", async (r) => r.url().includes("/api/auth/") && answers.push(await r.text().catch(() => "")));
    await page.goto(`${BASE}/login?next=%2Fprofile`);
    await page.locator("input").first().fill(account.username);
    await page.locator('input[type="password"]').fill(account.password);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(/\/profile/, { timeout: 15000 }).catch(() => {});
    check(
      "the login page signs in by username and lands where it was going",
      page.url().includes("/profile") && (await page.getByText(account.username).first().isVisible().catch(() => false)),
      page.url()
    );
    check("…and the browser never receives the email", answers.every((a) => !a.includes(account.email)));
  } finally {
    await browser.close();
  }

  // ── Supabase REST is closed (0015) ────────────────────────────────────────
  const client = anon();
  const { data } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  const rest = (path, init = {}) =>
    fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
        Authorization: `Bearer ${data.session.access_token}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
  for (const table of ["sessions", "session_players", "profiles", "answers", "game_content", "session_messages"]) {
    const r = await rest(`${table}?select=*&limit=1`);
    check(`a signed-in user can't read ${table} over REST`, r.status === 401 || r.status === 403, `${r.status}`);
  }
  const insert = await rest("session_players", { method: "POST", body: JSON.stringify({ session_id: crypto.randomUUID(), player_id: account.id }) });
  check("…nor add themselves to a session", insert.status === 401 || insert.status === 403, `${insert.status}`);
  const loggedOut = await fetch(`${env("NEXT_PUBLIC_SUPABASE_URL")}/rest/v1/sessions?select=share_code&limit=1`, {
    headers: { apikey: env("NEXT_PUBLIC_SUPABASE_ANON_KEY") },
  });
  check("logged out, nothing either", loggedOut.status === 401 || loggedOut.status === 403, `${loggedOut.status}`);
} catch (err) {
  console.log("ERROR", err.message.split("\n")[0]);
  fail();
} finally {
  await account.remove();
  await closeDb();
  done();
}
