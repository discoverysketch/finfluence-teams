// Backfill SIC codes from EDGAR.
//
// Without a SIC nothing classifies as a regulated utility, so utility accounts
// silently fall through to the generic "listed company" source plan and lose
// the rate-case and commission sources that make their research good.
//
//   npm run load-sic              accounts in the book only (fast, the default)
//   npm run load-sic -- --all     the whole entity directory (~6,500 calls, slow)
//
// The directory is 8,000+ entities and exists for name matching; archetype only
// matters for accounts anyone actually researches, so the book is the default.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const UA = { "User-Agent": "AccountFluency dan.wain1@gmail.com" };
const ALL = process.argv.includes("--all");

let targets = [];
if (ALL) {
  let from = 0;
  for (;;) {
    const { data } = await db.from("entities").select("id, canonical_name, cik, sic").range(from, from + 999);
    targets = targets.concat(data ?? []);
    if (!data || data.length < 1000) break;
    from += 1000;
  }
} else {
  const { data } = await db.from("accounts").select("entity:entities(id, canonical_name, cik, sic)");
  targets = (data ?? []).map((a) => a.entity).filter(Boolean);
}

const todo = targets.filter((e) => e.cik && !e.sic);
console.log(`${targets.length} ${ALL ? "entities" : "accounts"} · ${todo.length} need a SIC`);

let ok = 0, fail = 0;
const queue = [...todo];

async function worker() {
  while (queue.length) {
    const e = queue.shift();
    if (!e) break;
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${String(e.cik).padStart(10, "0")}.json`, { headers: UA });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const sic = j.sic ? String(j.sic) : null;
      if (!sic) throw new Error("no SIC in submissions");
      const { error } = await db.from("entities").update({ sic }).eq("id", e.id);
      if (error) throw new Error(error.message);
      ok++;
      console.log(`  ${sic}  ${String(j.sicDescription ?? "").slice(0, 34).padEnd(35)} ${e.canonical_name.slice(0, 34)}`);
    } catch (err) {
      fail++;
      console.log(`  ----  FAILED ${e.canonical_name.slice(0, 34)} — ${err.message}`);
    }
  }
}

// EDGAR's fair-use guidance is 10 requests/second; four in flight stays well
// inside it while finishing the book in seconds rather than minutes.
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`\n${ok} updated, ${fail} failed`);
