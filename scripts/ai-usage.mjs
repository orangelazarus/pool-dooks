#!/usr/bin/env node
// What AI has cost, from the ai_usage ledger (see lib/ai/service.ts).
//
//   node scripts/ai-usage.mjs            # the last 7 days
//   DAYS=30 node scripts/ai-usage.mjs
//
// Costs are core's estimates from token counts; the Anthropic console has the bill.
import { closeDb, db } from "./e2e/lib.mjs";

const days = Number(process.env.DAYS ?? 7);
const since = new Date(Date.now() - days * 86_400_000);
const dollars = (micros) => `$${(Number(micros) / 1e6).toFixed(4)}`;
const q = async (sql) => (await db().query(sql, [since])).rows;

try {
  console.log(`AI usage since ${since.toISOString().slice(0, 10)}\n`);

  console.log("By day");
  console.table(
    (await q(`select to_char(date_trunc('day', created_at at time zone 'utc'), 'YYYY-MM-DD') day,
                     count(*) filter (where outcome not like 'refused:%')::int calls,
                     count(*) filter (where outcome like 'refused:%')::int refusals,
                     sum(cost_micros) cost
              from ai_usage where created_at >= $1 group by 1 order by 1`)).map((r) => ({ ...r, cost: dollars(r.cost) }))
  );

  console.log("By game and use");
  console.table(
    (await q(`select game_type, use, count(*) filter (where outcome = 'ok')::int ok,
                     count(*) filter (where outcome = 'error')::int errors, sum(cost_micros) cost
              from ai_usage where created_at >= $1 and outcome not like 'refused:%'
              group by 1, 2 order by sum(cost_micros) desc`)).map((r) => ({ ...r, cost: dollars(r.cost) }))
  );

  console.log("Top users");
  console.table(
    (await q(`select coalesce(p.username, '(deleted)') username, count(*)::int calls,
                     count(distinct u.ip_hash)::int networks, sum(u.cost_micros) cost
              from ai_usage u left join profiles p on p.id = u.user_id
              where u.created_at >= $1 and u.outcome not like 'refused:%'
              group by 1 order by sum(u.cost_micros) desc limit 10`)).map((r) => ({ ...r, cost: dollars(r.cost) }))
  );

  // Who keeps hitting limits, and networks with many accounts: worth a look, and maybe an ai_blocks row.
  console.log("Refusals");
  console.table(await q(`select coalesce(p.username, '(deleted)') username, u.outcome reason, count(*)::int times
                         from ai_usage u left join profiles p on p.id = u.user_id
                         where u.created_at >= $1 and u.outcome like 'refused:%'
                         group by 1, 2 order by 3 desc limit 10`));
  console.log("Networks with several accounts");
  console.table(await q(`select left(ip_hash, 8) network, count(distinct user_id)::int accounts, count(*)::int calls
                         from ai_usage where created_at >= $1
                         group by ip_hash having count(distinct user_id) > 2 order by 2 desc limit 10`));

  const blocks = (await db().query("select scope, reason, created_at from ai_blocks order by created_at")).rows;
  console.log(blocks.length ? "Switched off" : "Nothing switched off (ai_blocks is empty)");
  if (blocks.length) console.table(blocks);
} finally {
  await closeDb();
}
