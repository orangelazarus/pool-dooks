#!/usr/bin/env node
// The Pool Dooks story editor (Tiptap) loads and takes typing, with no page
// errors. Worth running after upgrading Next or Tiptap. 1 guest sign-up.
//
//   node scripts/e2e/editor.mjs
import { checker, closeDb, guest, launch, screenshotAll, tag } from "./lib.mjs";

const { check, fail, done } = checker();
const browser = await launch();
try {
  const page = await guest(browser, "Ed", "/games/pool_dooks/create");
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const editor = page.locator(".ProseMirror").first();
  await editor.waitFor({ timeout: 15000 });
  await editor.click();
  await page.keyboard.type("Typed into Tiptap by the end-to-end check.");
  check("the editor renders and takes typing", (await editor.innerText()).includes("Typed into Tiptap"));
  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  console.log("ERROR", err.message.split("\n")[0]);
  await screenshotAll(browser, `editor-${tag}`);
  fail();
} finally {
  await browser.close();
  await closeDb();
  done();
}
