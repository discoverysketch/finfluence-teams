// Loads FERC Form 1 financials (net utility plant ≈ rate-base proxy, CWIP,
// electric O&M, electric revenue) from PUDL's cleaned parquet tables into
// entity_facts (source 'ferc'). Matches respondents to the directory via the
// same normalization + alias + parent-aggregation approach as load-eia.mjs.
// Sets ferc_respondent_id; upgrades tier D -> B. Idempotent. Run: npm run load-ferc
import { parquetReadObjects } from "hyparquet";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing URL / service key in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const SRC_URL = "https://data.catalyst.coop/ (PUDL · FERC Form 1)";
const wrap = (ab) => ({ byteLength: ab.byteLength, slice: (s, e) => ab.slice(s, e) });
async function load(name) {
  const r = await fetch(`https://s3.us-west-2.amazonaws.com/pudl.catalyst.coop/stable/${name}.parquet`);
  if (!r.ok) { console.error(`download failed: ${name} (${r.status})`); process.exit(1); }
  return parquetReadObjects({ file: wrap(await r.arrayBuffer()) });
}

console.log("Downloading PUDL FERC-1 tables…");
const [plant, expenses, revenues, assn] = await Promise.all([
  load("core_ferc1__yearly_utility_plant_summary_sched200"),
  load("core_ferc1__yearly_operating_expenses_sched320"),
  load("core_ferc1__yearly_operating_revenues_sched300"),
  load("core_pudl__assn_ferc1_pudl_utilities"),
]);
let YEAR = 0; for (const r of plant) { const y = Number(r.report_year); if (y > YEAR) YEAR = y; }
console.log(`latest report year: ${YEAR}`);

// FERC name per respondent id
const fercName = new Map();
for (const a of assn) if (a.utility_name_ferc1) fercName.set(Number(a.utility_id_ferc1), String(a.utility_name_ferc1));

// per-respondent figures ($ -> $M), per report year — latest year feeds the
// headline facts; the 5-year window feeds trend history.
const YEARS = []; for (let y = YEAR - 4; y <= YEAR; y++) YEARS.push(y);
const M = (v) => Number(v) / 1e6;
const figs = new Map(); // year -> Map(id -> { net_plant, cwip, om, revenue })
const getY = (y, id) => {
  let m = figs.get(y); if (!m) { m = new Map(); figs.set(y, m); }
  const f = m.get(id) ?? {}; m.set(id, f); return f;
};

for (const r of plant) {
  const y = Number(r.report_year);
  if (!YEARS.includes(y) || r.utility_type !== "total") continue;
  const id = Number(r.utility_id_ferc1), v = Number(r.ending_balance);
  if (!isFinite(v)) continue;
  if (r.utility_plant_asset_type === "utility_plant_net") getY(y, id).net_plant = M(v);
  if (r.utility_plant_asset_type === "construction_work_in_progress") getY(y, id).cwip = M(v);
}
// discover the O&M total key (naming drifted across PUDL versions)
const omCandidates = ["operations_and_maintenance_expenses_electric", "operation_and_maintenance_expenses_electric", "total_operation_and_maintenance_expense"];
const exTypes = new Set(expenses.filter((r) => Number(r.report_year) === YEAR).map((r) => String(r.expense_type)));
const omKey = omCandidates.find((k) => exTypes.has(k));
console.log("O&M key:", omKey ?? `NOT FOUND — candidates near: ${[...exTypes].filter((t) => /maintenance_expenses|_expenses_electric$/.test(t)).slice(0, 6).join(" | ")}`);
if (omKey) for (const r of expenses) {
  const y = Number(r.report_year);
  if (!YEARS.includes(y) || String(r.expense_type) !== omKey) continue;
  const v = Number(r.dollar_value);
  if (isFinite(v)) getY(y, Number(r.utility_id_ferc1)).om = M(v);
}
for (const r of revenues) {
  const y = Number(r.report_year);
  if (!YEARS.includes(y) || String(r.revenue_type) !== "sales_of_electricity") continue;
  const v = Number(r.dollar_value);
  if (isFinite(v)) getY(y, Number(r.utility_id_ferc1)).revenue = M(v);
}
const fig = figs.get(YEAR) ?? new Map(); // latest year drives matching + headline facts
const withData = [...fig.entries()].filter(([, f]) => f.net_plant != null || f.om != null);
console.log(`respondents with ${YEAR} data: ${withData.length}`);

// ---------- match to directory (same normalization family as load-eia) ----------
const ABBR = [[/\butil\b/g, "utility"], [/\bdist\b/g, "district"], [/\bcoop\b/g, "cooperative"], [/\belec\b/g, "electric"], [/\bpwr\b/g, "power"], [/\bassn\b/g, "association"], [/\bdept\b/g, "department"], [/\bserv\b/g, "service"], [/\bsvcs?\b/g, "services"]];
function norm(s) {
  let t = String(s || "").toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|llc|lp|ltd|corp|corporation|company|companies|co|and|of|d\s?b\s?a)\b/g, " ");
  for (const [re, to] of ABBR) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}
const byNorm = new Map();
for (const [id] of withData) {
  const n = norm(fercName.get(id));
  if (!n) continue;
  (byNorm.get(n) ?? byNorm.set(n, []).get(n)).push(id);
}

async function allEntities(sel) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("entities").select(sel).range(from, from + 999);
    if (error) { console.error("entities fetch:", error.message); process.exit(1); }
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const ents = await allEntities("id, canonical_name, data_tier, ferc_respondent_id");
const { data: aliases } = await db.from("entity_aliases").select("entity_id, alias");
const aliasesOf = new Map();
for (const a of aliases ?? []) (aliasesOf.get(a.entity_id) ?? aliasesOf.set(a.entity_id, []).get(a.entity_id)).push(a.alias);

function findRespondents(ent) {
  const found = new Set();
  const cn = norm(ent.canonical_name);
  for (const id of byNorm.get(cn) ?? []) found.add(id);
  if (!found.size && cn.length >= 6) {
    // Opcos carry the parent brand as a prefix ("Evergy Kansas Central",
    // "Unitil Energy Systems") — collect ALL of them; they sum like aliases do.
    const fwd = [...byNorm.entries()].filter(([en]) => en.startsWith(cn + " ")).flatMap(([, ids]) => ids);
    if (fwd.length >= 1 && fwd.length <= 8) for (const id of fwd) found.add(id);
    if (!found.size) {
      const rev = [...byNorm.entries()].filter(([en]) => cn.startsWith(en + " ")).flatMap(([, ids]) => ids);
      if (rev.length === 1) found.add(rev[0]);
    }
  }
  for (const al of aliasesOf.get(ent.id) ?? []) {
    const n = norm(al);
    if (n.length < 8) continue;
    for (const id of byNorm.get(n) ?? []) found.add(id);
  }
  return [...found];
}

let matched = 0; const factRows = []; const pairs = [];
for (const ent of ents ?? []) {
  const ids = findRespondents(ent);
  if (!ids.length) continue;
  const sum = { net_plant: 0, cwip: 0, om: 0, revenue: 0, n: 0 };
  const has = { net_plant: false, cwip: false, om: false, revenue: false };
  for (const id of ids) {
    const f = fig.get(id) ?? {};
    for (const k of ["net_plant", "cwip", "om", "revenue"]) if (f[k] != null) { sum[k] += f[k]; has[k] = true; }
    sum.n++;
  }
  if (!has.net_plant && !has.om) continue;
  matched++;
  pairs.push([ent, ids, sum]);
  const push = (fact_key, v, ok) => { if (ok && isFinite(v) && v !== 0) factRows.push({ entity_id: ent.id, source: "ferc", fact_key, period: String(YEAR), value: Math.round(v * 10) / 10, unit: "USD_millions", source_url: SRC_URL }); };
  push("net_utility_plant", sum.net_plant, has.net_plant);
  push("cwip", sum.cwip, has.cwip);
  push("om_expense", sum.om, has.om);
  push("electric_revenue", sum.revenue, has.revenue);
  push("respondents_count", sum.n, sum.n > 1);

  // 5-year history for trends, as year-suffixed keys. Honesty guard: skip a
  // year unless every respondent that reports net plant TODAY reported it then
  // too — partial old years would render as fake dips in the trendline.
  const curCnt = ids.filter((id) => (fig.get(id) ?? {}).net_plant != null).length;
  for (const y of YEARS) {
    const m = figs.get(y); if (!m) continue;
    const cnt = ids.filter((id) => (m.get(id) ?? {}).net_plant != null).length;
    if (cnt < curCnt || cnt === 0) continue;
    const s = { net_plant: 0, cwip: 0, revenue: 0 };
    const h = { net_plant: false, cwip: false, revenue: false };
    for (const id of ids) {
      const f = m.get(id) ?? {};
      for (const k of Object.keys(s)) if (f[k] != null) { s[k] += f[k]; h[k] = true; }
    }
    const pushY = (base, v, ok) => { if (ok && isFinite(v) && v !== 0) factRows.push({ entity_id: ent.id, source: "ferc", fact_key: `${base}_${y}`, period: String(y), value: Math.round(v * 10) / 10, unit: "USD_millions", source_url: SRC_URL }); };
    pushY("net_utility_plant", s.net_plant, h.net_plant);
    pushY("cwip", s.cwip, h.cwip);
    pushY("electric_revenue", s.revenue, h.revenue);
  }
}
console.log(`matched ${matched} directory entities · ${factRows.length} facts`);

const ids = pairs.map(([e]) => e.id);
for (let i = 0; i < ids.length; i += 100) await db.from("entity_facts").delete().in("entity_id", ids.slice(i, i + 100)).eq("source", "ferc");
for (let i = 0; i < factRows.length; i += 400) {
  const { error } = await db.from("entity_facts").insert(factRows.slice(i, i + 400));
  if (error) { console.error("insert error:", error.message); process.exit(1); }
}
for (const [ent, rids] of pairs) {
  const upd = { ferc_respondent_id: String(rids[0]) };
  if (ent.data_tier === "D" || ent.data_tier == null) upd.data_tier = "B";
  await db.from("entities").update(upd).eq("id", ent.id);
}

console.log("\nVerification checklist:");
for (const q of ["Duke Energy", "AMERICAN ELECTRIC", "UNITIL", "EXELON", "NEXTERA", "Evergy", "PINNACLE WEST"]) {
  const hit = pairs.find(([e]) => e.canonical_name.toUpperCase().includes(q.toUpperCase()));
  if (hit) {
    const [ent, rids, s] = hit;
    const trend = YEARS.map((y) => {
      const row = factRows.find((r) => r.entity_id === ent.id && r.fact_key === `net_utility_plant_${y}`);
      return row ? `${y}:$${(row.value / 1000).toFixed(1)}B` : `${y}:—`;
    }).join(" ");
    console.log(`  ✓ ${ent.canonical_name.slice(0, 32).padEnd(32)} ${String(rids.length).padStart(2)} resp · net plant $${(s.net_plant / 1000).toFixed(1)}B · O&M $${(s.om / 1000).toFixed(1)}B · elec rev $${(s.revenue / 1000).toFixed(1)}B\n      trend ${trend}`);
  } else console.log(`  ✗ ${q} — not matched`);
}
console.log(`\nDone. ${matched} entities carry FERC Form 1 ${YEAR} data.`);
