#!/usr/bin/env node
// Deletes what the end-to-end scripts left in the (production) database:
// their guests, the sessions only those guests played, anything those guests
// authored, and any throwaway email account a crashed run didn't remove.
//
//   node scripts/e2e/cleanup.mjs              # dry run: lists what would go
//   node scripts/e2e/cleanup.mjs --delete     # deletes it
//   HOURS=48 node scripts/e2e/cleanup.mjs     # look further back (default 24)
//
// A guest is only touched if all of these hold: its name matches the e2e
// pattern, it was created inside the window, and its login is anonymous. A
// session is only touched if every player in it is such a guest.
import { GUEST_NAME, THROWAWAY_EMAIL, admin, closeDb, db } from "./lib.mjs";

const apply = process.argv.includes("--delete");
const hours = Number(process.env.HOURS ?? 24);
const since = new Date(Date.now() - hours * 3600 * 1000);
const auth = admin().auth.admin;

// Every auth user created in the window (paged).
const recent = [];
for (let page = 1; ; page++) {
  const { data, error } = await auth.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  recent.push(...data.users.filter((u) => new Date(u.created_at) >= since));
  if (data.users.length < 1000) break;
}
const byId = new Map(recent.map((u) => [u.id, u]));

const { rows: named } = await db().query(
  "select id, username from profiles where created_at >= $1 and username ~ $2 order by created_at",
  [since, GUEST_NAME.source]
);
const guests = named.filter((p) => byId.get(p.id)?.is_anonymous);
const throwaways = recent.filter((u) => u.email && THROWAWAY_EMAIL.test(u.email));
const people = [...guests.map((g) => g.id), ...throwaways.map((u) => u.id)];

const { rows: sessions } = await db().query(
  `select s.id, s.share_code, s.status from sessions s
   where s.host_id = any($1::uuid[])
     and not exists (select 1 from session_players sp where sp.session_id = s.id and not (sp.player_id = any($1::uuid[])))
   order by s.created_at`,
  [people]
);
const { rows: content } = await db().query("select id, title from game_content where author_id = any($1::uuid[])", [people]);

console.log(`Looking back ${hours}h (since ${since.toISOString()})`);
console.log(`guests (${guests.length}): ${guests.map((g) => g.username).join(" ") || "-"}`);
console.log(`throwaway email accounts (${throwaways.length}): ${throwaways.map((u) => u.email).join(" ") || "-"}`);
console.log(`sessions with only those players (${sessions.length}): ${sessions.map((s) => `${s.share_code}:${s.status}`).join(" ") || "-"}`);
console.log(`content they authored (${content.length}): ${content.map((c) => c.title).join(" | ") || "-"}`);

if (!apply) {
  console.log("\nDry run. Run with --delete to remove all of the above.");
} else if (people.length || sessions.length) {
  const client = await db().connect();
  try {
    await client.query("begin");
    // Sessions first: they cascade to their players, answers, state and chat.
    await client.query("delete from sessions where id = any($1::uuid[])", [sessions.map((s) => s.id)]);
    await client.query("delete from game_content where author_id = any($1::uuid[])", [people]);
    await client.query("delete from profiles where id = any($1::uuid[])", [people]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  let removed = 0;
  for (const id of people) {
    const { data } = await auth.getUserById(id);
    // Re-checked right before deleting: only guests and throwaway addresses.
    if (!data.user || !(data.user.is_anonymous || THROWAWAY_EMAIL.test(data.user.email ?? ""))) continue;
    if (!(await auth.deleteUser(id)).error) removed++;
  }
  console.log(`\nDeleted ${sessions.length} sessions, ${content.length} content rows, ${people.length} profiles, ${removed} logins.`);
}
await closeDb();
