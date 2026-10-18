// Shared helpers for the end-to-end scripts in this folder. See README.md.
//
// These drive real browsers against a running server, and the server's
// database is production (.env.local has no other). Everything they create is
// named so cleanup.mjs can find it: guests are "e2e" + a role + a run tag, and
// throwaway email accounts are e2e-<tag>@example.com (deleted by the script
// that made them).
import { readFileSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

export const root = joinPath(dirname(fileURLToPath(import.meta.url)), "..", "..");

const envFile = readFileSync(joinPath(root, ".env.local"), "utf8");
/** A value from .env.local. Never printed. */
export function env(key) {
  const match = envFile.match(new RegExp(`^${key}=["']?([^"'\\n]+)`, "m"));
  if (!match) throw new Error(`${key} is missing from .env.local`);
  return match[1];
}

/** The server under test. Port 3000 locally: the lobby calls back to NEXT_PUBLIC_APP_URL. */
export const BASE = process.env.BASE ?? "http://localhost:3000";

/** Short and unique per run, so names don't collide and cleanup can tell runs apart. */
export const tag = Date.now().toString(36).slice(-4);

/** Every guest a script signs up is named this way; cleanup.mjs matches it. */
export const guestName = (role) => `e2e${role}${tag}`;
export const GUEST_NAME = /^e2e[A-Za-z]{1,3}[0-9a-z]{4}(_[0-9a-z]{3})?$/;
export const THROWAWAY_EMAIL = /^e2e-[0-9a-z]+@example\.com$/;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns truthy or `ms` passes. */
export async function until(fn, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (await fn()) return true;
    } catch {}
    await sleep(300);
  }
  return false;
}

/** PASS/FAIL lines, and a tally for the end of the run. */
export function checker() {
  const results = [];
  return {
    check(name, ok, extra = "") {
      results.push(!!ok);
      console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
    },
    fail() {
      results.push(false);
    },
    /** Prints the tally and sets the exit code. */
    done() {
      const failed = results.filter((ok) => !ok).length;
      console.log(`\n${results.length - failed}/${results.length} passed`);
      process.exitCode = failed ? 1 : 0;
    },
  };
}

/** Chromium from `npx playwright-core install chromium`, or CHROMIUM_PATH. */
export function launch() {
  return chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
}

/**
 * A new browser signed in as a new guest, ending up at `next`. Each one is a
 * guest sign-up, and Supabase allows about 30 an hour per IP: when it runs out
 * this times out, so look for a 429 from /auth/v1/signup before debugging the app.
 */
export async function guest(browser, role, next) {
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", (d) => d.accept());
  page.role = role;
  await page.goto(`${BASE}/guest?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Your name").fill(guestName(role));
  await page.getByRole("button", { name: "Play as guest" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/guest"));
  return page;
}

/** A guest who creates a session of `gameType` from public content; returns its page and share code. */
export async function host(browser, role, gameType, { isPublic = false } = {}) {
  const page = await guest(browser, role, `/sessions/new?gameType=${gameType}&gameContentId=${await publicContentId(gameType)}`);
  if (isPublic) {
    await page.getByRole("switch").last().click();
    await page.getByText("Listed on the home page").waitFor({ timeout: 5000 });
  }
  await page.getByRole("button", { name: "Create Session" }).click();
  await page.waitForURL(/\/sessions\/[A-Z0-9]{6}$/);
  return { page, code: page.url().split("/").pop() };
}

/** A guest who joins `code` through the invite link. */
export async function join(browser, role, code) {
  const page = await (await browser.newContext()).newPage();
  page.on("dialog", (d) => d.accept());
  page.role = role;
  await page.goto(`${BASE}/sessions/${code}`);
  await page.getByPlaceholder("e.g. Alex").fill(guestName(role));
  await page.locator("form button[type=submit]").click();
  await page.getByText("Waiting for the host").waitFor({ timeout: 20000 });
  return page;
}

/** The lobby's "Players (n)". */
export const playerCount = async (page) => Number((await page.getByText(/^Players \(\d+\)$/).textContent()).match(/\d+/)[0]);

/** Screenshots every open page, for a run that stopped with an error. */
export async function screenshotAll(browser, label) {
  for (const page of browser.contexts().flatMap((c) => c.pages())) {
    const path = joinPath(root, "scripts", "e2e", "shots", `${label}-${page.role ?? "page"}.png`);
    await page.screenshot({ path }).catch(() => {});
    console.log(`  ${page.role ?? "page"}: ${page.url()}  (${path})`);
  }
}

let pool;
/** The app's database connection (production). */
export function db() {
  pool ??= new pg.Pool({ connectionString: env("DATABASE_URL"), ssl: { rejectUnauthorized: false }, max: 2 });
  return pool;
}

/** The newest public content row of a game, to start sessions from. */
export async function publicContentId(gameType) {
  const { rows } = await db().query(
    "select id from game_content where game_type = $1 and is_public order by created_at desc limit 1",
    [gameType]
  );
  if (!rows[0]) throw new Error(`No public ${gameType} content to start a session from`);
  return rows[0].id;
}

/** Supabase with the service role: admin APIs. Never reaches a browser. */
export const admin = () =>
  createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

/** Supabase as a browser would use it: the public anon key. */
export const anon = () =>
  createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"), { auth: { persistSession: false } });

/**
 * A confirmed email account with a profile, for tests that need a password
 * login. No guest sign-up is used. Always call `remove()` (in a finally).
 */
export async function throwawayAccount() {
  const email = `e2e-${tag}${Math.random().toString(36).slice(2, 6)}@example.com`;
  const password = `pw-${crypto.randomUUID()}`;
  const username = `e2eU${tag}`;
  const { data, error } = await admin().auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const id = data.user.id;
  await db().query("insert into profiles (id, username) values ($1, $2)", [id, username]);
  return {
    id,
    email,
    password,
    username,
    async remove() {
      await db().query("delete from profiles where id = $1", [id]);
      await admin().auth.admin.deleteUser(id);
    },
  };
}

/** Closes the database pool so the script can exit. */
export const closeDb = () => pool?.end();
