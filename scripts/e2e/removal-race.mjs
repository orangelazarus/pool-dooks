#!/usr/bin/env node
// The race behind PR #35: a player reopens the invite and is removed the
// instant the lobby appears, while their page is still joining its live
// channel. The join is refused, so the removal never arrives live; the page
// must still end up telling them (it asks the server once the join is
// refused). 2 guest sign-ups.
//
//   node scripts/e2e/removal-race.mjs
//   DELAY=2000 node scripts/e2e/removal-race.mjs   # remove later, once joined
import { BASE, checker, closeDb, guestName, host, join, launch, screenshotAll, sleep, tag } from "./lib.mjs";

const { check, fail, done } = checker();
const browser = await launch();
try {
  const { page: hostPage, code } = await host(browser, "R", "subterfuge");
  const d = await join(browser, "S", code);

  await d.getByRole("button", { name: "Leave game" }).click();
  await d.waitForURL(/\/home$/);
  await d.goto(`${BASE}/sessions/${code}`);
  await d.getByText("Waiting for the host").waitFor({ timeout: 20000 });
  await sleep(Number(process.env.DELAY ?? 0));
  await hostPage.getByRole("button", { name: `Remove ${guestName("S")}` }).click();

  await sleep(8000);
  const told = await d.getByText("You were removed from this game").isVisible();
  check("the removed player is sent home or told", d.url().endsWith("/home") || told, d.url());
  check("…and isn't left looking at the lobby", !(await d.getByText("Waiting for the host").isVisible().catch(() => false)));
  console.log(`\nsession: ${code}  guest tag: ${tag}`);
} catch (err) {
  console.log("ERROR", err.message.split("\n")[0]);
  await screenshotAll(browser, `removal-race-${tag}`);
  fail();
} finally {
  await browser.close();
  await closeDb();
  done();
}
