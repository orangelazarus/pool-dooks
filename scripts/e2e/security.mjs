#!/usr/bin/env node
// Security probes that need real sessions: who may listen to and send on a
// session's live-update channel, whether private content stays private, and
// that GET actions still answer. 4 guest sign-ups (3 players and one
// signed-in stranger, deleted at the end).
//
//   node scripts/e2e/security.mjs
//   BASE=https://pooldooks.com node scripts/e2e/security.mjs
import { BASE, admin, anon, checker, closeDb, host, join, launch, playerCount, screenshotAll, sleep, tag } from "./lib.mjs";

const { check, fail, done } = checker();
const browser = await launch();
const api = (page, path, opts = {}) =>
  page.request.fetch(BASE + path, { method: opts.method ?? "GET", data: opts.data, failOnStatusCode: false });

/** Subscribes `client` to `topic`; resolves with the join status and a list that fills with what arrives. */
function listen(client, topic, priv) {
  return new Promise((resolve) => {
    const got = [];
    const channel = client.channel(topic, { config: { private: priv } }).on("broadcast", { event: "*" }, (m) => got.push(m.payload));
    const settle = (status) => resolve({ status, got, channel });
    channel.subscribe((s) => (s === "SUBSCRIBED" || s === "CHANNEL_ERROR" || s === "TIMED_OUT") && settle(s));
    setTimeout(() => settle("NO_REPLY"), 8000);
  });
}

let strangerId = null;
try {
  // ── Live-update channels ──────────────────────────────────────────────────
  const { page: hostPage, code } = await host(browser, "X", "subterfuge");
  console.log(`private lobby ${code}`);
  await sleep(2000);

  const eavesdropper = await listen(anon(), `session:${code}`, false);
  const outsider = await listen(anon(), `session:${code}`, true);
  check("a logged-out outsider can't join a private session's channel", outsider.status === "CHANNEL_ERROR", outsider.status);

  const stranger = anon();
  const { data: signedIn } = await stranger.auth.signInAnonymously();
  strangerId = signedIn.user?.id ?? null;
  await stranger.realtime.setAuth();
  const strangerJoin = await listen(stranger, `session:${code}`, true);
  check("…nor can a signed-in stranger", strangerJoin.status === "CHANNEL_ERROR", strangerJoin.status);

  // Forge "the host removed you", on the public topic and on the private one.
  const forged = { type: "player:left", payload: { playerId: "x", reason: "kicked" } };
  await eavesdropper.channel.send({ type: "broadcast", event: "player:left", payload: forged });
  const privateSend = await anon()
    .channel(`session:${code}`, { config: { private: true } })
    .httpSend("player:left", forged)
    .then(() => "sent", (e) => e.message);
  check("nobody but the server can send on the private channel", privateSend !== "sent", privateSend);

  // A real event: someone joins. The host hears it; the eavesdropper doesn't.
  const joiner = await join(browser, "Y", code);
  let hostSaw = false;
  for (let i = 0; i < 20 && !hostSaw; i++) {
    hostSaw = (await playerCount(hostPage).catch(() => 0)) === 2;
    await sleep(500);
  }
  check("real players still get live updates", hostSaw);
  check("a public eavesdropper on the same topic hears nothing", eavesdropper.got.length === 0, `${eavesdropper.got.length} received`);
  check("the host's page ignored the forged event", hostPage.url().endsWith(`/sessions/${code}`));

  // A public game: anyone, even logged out, may watch.
  const { page: publicHost, code: publicCode } = await host(browser, "Z", "subterfuge", { isPublic: true });
  const spectator = await listen(anon(), `session:${publicCode}`, true);
  check("a logged-out spectator can listen to a public game", spectator.status === "SUBSCRIBED", spectator.status);
  await publicHost.getByRole("button", { name: "Leave game" }).click(); // closes the public lobby

  // ── Private content ───────────────────────────────────────────────────────
  const made = await api(hostPage, "/api/games/pool_dooks/content/create", {
    method: "POST",
    data: {
      title: `Private e2e ${tag}`,
      theme: "test",
      isPublic: false,
      bodyJson: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "secret e2e text" }] }] },
    },
  });
  const story = await made.json();
  check("an author can create a private story", made.status() === 200 && !!story.id, `${made.status()}`);
  const id = story.id;

  check("…and read it back", (await api(hostPage, `/api/games/pool_dooks/content/get?id=${id}`)).status() === 200);
  const theirs = await api(joiner, `/api/games/pool_dooks/content/get?id=${id}`);
  check("another guest can't read it", theirs.status() === 404 && !(await theirs.text()).includes("secret"), `${theirs.status()}`);
  const meta = await api(joiner, `/api/game-content/meta?gameType=pool_dooks&gameContentId=${id}`);
  check("…nor see its title", meta.status() === 404, `${meta.status()}`);
  const start = await api(joiner, "/api/sessions", { method: "POST", data: { gameType: "pool_dooks", gameContentId: id } });
  check("…nor start a game with it", start.status() === 404, `${start.status()}`);
  const listed = await (await api(joiner, `/api/games/pool_dooks/content/list?search=${encodeURIComponent(`Private e2e ${tag}`)}`)).json();
  check("…nor find it in the list", Array.isArray(listed) && !listed.some((s) => s.id === id));
  const removed = await api(hostPage, "/api/games/pool_dooks/content/remove", { method: "DELETE", data: { id } });
  check("the author can delete it", removed.status() === 200, `${removed.status()}`);

  // ── GET actions are read-only, and still answer ───────────────────────────
  await hostPage.getByRole("button", { name: "Start Game" }).click().catch(() => {});
  await hostPage.waitForURL(/\/play$/, { timeout: 15000 }).catch(() => {});
  const view = await api(hostPage, `/api/games/subterfuge/sessions/${code}/state`);
  check("read-only GET actions still answer", view.status() === 200, `${view.status()}`);

  console.log(`\nsessions: ${code} ${publicCode}  guest tag: ${tag}`);
} catch (err) {
  console.log("ERROR", err.message.split("\n")[0]);
  await screenshotAll(browser, `security-${tag}`);
  fail();
} finally {
  await browser.close();
  if (strangerId) await admin().auth.admin.deleteUser(strangerId).catch(() => {});
  await closeDb();
  done();
  // Realtime sockets keep the process alive.
  setTimeout(() => process.exit(process.exitCode), 100);
}
