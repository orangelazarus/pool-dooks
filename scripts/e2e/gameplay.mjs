#!/usr/bin/env node
// Gameplay smoke test: a lobby's join / leave / rejoin / remove, then leaving
// mid-game in Subterfuge and Acrophobia. Everything here depends on live
// updates reaching the other browsers. 8 guest sign-ups.
//
//   node scripts/e2e/gameplay.mjs                 # against localhost:3000
//   BASE=https://pooldooks.com node scripts/e2e/gameplay.mjs
//   TRACE=D node scripts/e2e/gameplay.mjs         # also log player D's realtime frames
//
// Never prints question prompts or answers.
import { BASE, checker, closeDb, guestName, host, join, launch, playerCount, screenshotAll, tag, until } from "./lib.mjs";

const { check, fail, done } = checker();
const browser = await launch();

/** Logs one player's channel joins, replies and events, with timings (TRACE=<role>). */
function trace(page) {
  if (process.env.TRACE !== page.role) return;
  const t0 = Date.now();
  const at = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  const log = (dir, frame) => {
    const s = String(frame.payload).replace(/\u0000/g, "");
    if (/session:/.test(s) && !/heartbeat/.test(s)) {
      console.log(`  [${page.role} ${at()} ${dir}] ${s.replace(/"access_token":"[^"]+"/, '"access_token":"<jwt>"').slice(0, 150)}`);
    }
  };
  page.on("websocket", (ws) => {
    ws.on("framereceived", (f) => log("<-", f));
    ws.on("framesent", (f) => log("->", f));
  });
  page.on("framenavigated", (fr) => fr === page.mainFrame() && console.log(`  [${page.role} ${at()} nav] ${fr.url()}`));
}

const leaveMidGame = async (page) => {
  await page.getByRole("button", { name: "Game options" }).click();
  await page.getByRole("menuitem", { name: "Leave game" }).click();
};

try {
  // ── Lobby: leave, rejoin, remove ──────────────────────────────────────────
  const { page: a, code } = await host(browser, "A", "subterfuge");
  console.log(`Subterfuge session ${code}`);
  const b = await join(browser, "B", code);
  const c = await join(browser, "C", code);
  const d = await join(browser, "D", code);
  [a, b, c, d].forEach(trace);
  check("lobby: host sees 4 players", await until(async () => (await playerCount(a)) === 4));

  await d.getByRole("button", { name: "Leave game" }).click();
  check("lobby: leaver is sent home", await until(async () => d.url().endsWith("/home")));
  check("lobby: others see 3 after leave", await until(async () => (await playerCount(a)) === 3 && (await playerCount(b)) === 3));

  await d.goto(`${BASE}/sessions/${code}`);
  check("lobby: leaver can rejoin via invite", await until(async () => (await playerCount(d)) === 4 && (await playerCount(a)) === 4));

  await a.getByRole("button", { name: `Remove ${guestName("D")}` }).click();
  // Sent home if the removal arrives live; told so if it lands while D's page is
  // still joining the channel (the join is refused, and the page asks the server).
  check(
    "lobby: removed player is sent home or told",
    await until(async () => d.url().endsWith("/home") || (await d.getByText("You were removed from this game").isVisible()))
  );
  check("lobby: others see 3 after removal", await until(async () => (await playerCount(a)) === 3 && (await playerCount(c)) === 3));
  await d.goto(`${BASE}/sessions/${code}`);
  check("lobby: removed player can't rejoin", await until(() => d.getByText("You were removed from this game").isVisible()));

  // ── Subterfuge: reopening the invite and leaving mid-game ─────────────────
  await a.getByRole("button", { name: "Start Game" }).click();
  check("subterfuge: all three reach /play", await until(async () => [a, b, c].every((p) => p.url().endsWith("/play"))));
  const lieBox = (p) => p.getByPlaceholder("Write a convincing lie");
  check("subterfuge: lie form shown", await until(async () => (await lieBox(a).isVisible()) && (await lieBox(c).isVisible())));

  // Reopening the invite link mid-game keeps the seat.
  await c.goto(`${BASE}/sessions/${code}`);
  check("subterfuge: reopened invite goes to /play", await until(async () => c.url().endsWith("/play")));
  check("subterfuge: reopener is still a player", await until(() => lieBox(c).isVisible()));

  for (const [p, n] of [[a, 1], [b, 2]]) {
    await lieBox(p).fill(`zzq e2e lie ${n} ${tag}`);
    await p.getByRole("button", { name: "Submit" }).click();
  }
  check("subterfuge: two lies in, still waiting", await until(() => a.getByText("Your lie:").isVisible()));

  await leaveMidGame(c);
  const guessing = (p) => p.getByText("Which one is the truth?").isVisible();
  check("subterfuge: game moves on after the last writer leaves", await until(async () => (await guessing(a)) && (await guessing(b))));
  const menuHas = async (p, item) => {
    await p.getByRole("button", { name: "Game options" }).click();
    const has = await p.getByRole("menuitem", { name: item }).isVisible();
    await p.keyboard.press("Escape");
    return has;
  };
  check(
    "subterfuge: host menu no longer offers the leaver",
    !(await menuHas(a, `Remove ${guestName("C")}`)) && (await menuHas(a, `Remove ${guestName("B")}`))
  );
  await c.goto(`${BASE}/sessions/${code}/play`);
  check("subterfuge: leaver no longer gets the play controls", !(await lieBox(c).isVisible()) && !(await guessing(c)));

  // ── Acrophobia: leaving mid-game ──────────────────────────────────────────
  const { page: e, code: acode } = await host(browser, "E", "acrophobia");
  console.log(`Acrophobia session ${acode}`);
  const f = await join(browser, "F", acode);
  const g = await join(browser, "G", acode);
  const h = await join(browser, "H", acode);
  check("acro: host sees 4 players", await until(async () => (await playerCount(e)) === 4));
  await e.getByRole("button", { name: "Start Game" }).click();
  const players = [e, f, g, h];
  check("acro: all four reach /play", await until(async () => players.every((p) => p.url().endsWith("/play"))));

  // A round may open with a category pick by whoever won the last one.
  await until(async () => {
    for (const p of players) {
      const pick = p.getByPlaceholder("Or make one up");
      if (await pick.isVisible()) {
        await pick.fill("End to end");
        await p.getByRole("button", { name: "Use" }).click();
      }
    }
    return e.getByPlaceholder(/words, starting/).isVisible();
  }, 20000);
  const answerBox = (p) => p.getByPlaceholder(/words, starting/);
  const answer = async (p, i) => {
    const letters = (await answerBox(p).getAttribute("placeholder")).match(/starting (.*)$/)[1].split(", ");
    await answerBox(p).fill(letters.map((l, j) => `${l}${["ardvark", "ble", "ozy", "elta"][(i + j) % 4]}`).join(" "));
    await p.getByRole("button", { name: "Submit" }).click();
  };
  for (const [p, i] of [[e, 0], [f, 1], [g, 2]]) await answer(p, i);
  check("acro: three answers in, waiting on the fourth", await until(() => e.getByText("Your answer:").isVisible()));

  await leaveMidGame(h);
  const voting = (p) => p.getByText(/Vote for your favourite|Locked in\./).isVisible();
  check("acro: game moves on to voting after the last writer leaves", await until(async () => (await voting(e)) && (await voting(f))));

  // Down to two players: the game can't go on, so it ends.
  await leaveMidGame(g);
  check("acro: falling below three ends the game", await until(async () => e.url().includes("/reveal") && f.url().includes("/reveal"), 20000));
  const reveal = await e.locator("body").innerText();
  check("acro: reveal still names players who left", reveal.includes(guestName("G")) && reveal.includes(guestName("H")));

  console.log(`\nsessions: ${code} ${acode}  guest tag: ${tag}`);
} catch (err) {
  console.log("ERROR", err.message.split("\n")[0]);
  await screenshotAll(browser, `gameplay-${tag}`);
  fail();
} finally {
  await browser.close();
  await closeDb();
  done();
}
