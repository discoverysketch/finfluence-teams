// Coverage across the book. Paginates entity_facts — an unpaginated select
// silently stops at 1000 rows and makes whole sources look missing.
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: accts } = await db.from("accounts")
  .select("id, entity:entities(id, canonical_name, cik, comp_json, priorities_json, decision_locus, hiring_json, stack_json, fleet_json, inferred_json)");
const ents = [...new Map((accts ?? []).filter((a) => a.entity).map((a) => [a.entity.id, a.entity])).values()];
const ids = new Set(ents.map((e) => e.id));
const filers = ents.filter((e) => e.cik).length;

const bySrc = {};
for (let from = 0; ; from += 1000) {
  const { data } = await db.from("entity_facts").select("entity_id, source").range(from, from + 999);
  for (const f of data ?? []) if (ids.has(f.entity_id)) (bySrc[f.source] ??= new Set()).add(f.entity_id);
  if (!data || data.length < 1000) break;
}

const n = ents.length;
const pct = (x) => `${String(x).padStart(2)}/${n}  ${"█".repeat(Math.round((x / n) * 20)).padEnd(20, "·")}`;
console.log(`BOOK: ${n} companies (${filers} SEC filers, ${n - filers} non-filers)\n`);
console.log("TIER 1 — bulk, free, deterministic");
console.log(`  SEC financials  ${pct((bySrc.sec ?? new Set()).size)}`);
console.log(`  EIA-861 ops     ${pct((bySrc.eia ?? new Set()).size)}`);
console.log(`  FERC Form 1     ${pct((bySrc.ferc ?? new Set()).size)}`);
console.log(`  EIA-860 fleet   ${pct(ents.filter((e) => e.fleet_json).length)}`);
console.log("\nTIER 2 — researched once, cached, team-shared");
for (const [k, l] of [["comp_json", "Comp levers  "], ["hiring_json", "Hiring       "], ["decision_locus", "Decision     "], ["priorities_json", "Priorities   "]])
  console.log(`  ${l}   ${pct(ents.filter((e) => e[k]).length)}`);
console.log("\nTIER 3 — on demand, per rep");
console.log(`  Battlecard      ${pct(ents.filter((e) => e.stack_json).length)}`);
console.log(`  Inferred read   ${ents.filter((e) => e.inferred_json).length}/${n - filers} non-filers`);
