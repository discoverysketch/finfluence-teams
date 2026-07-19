// Loads EIA-861 (annual utility ops: customers, MWh, revenue by class) into
// entity_facts (source 'eia') for entities already in the directory. Sets
// eia_utility_id and upgrades data_tier D -> B on match. Idempotent; annual.
// Run: npm run load-eia
import AdmZip from "adm-zip";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing URL / service key in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const YEAR = 2024;
const SRC_URL = "https://www.eia.gov/electricity/data/eia861/";

// EIA uses abbreviated legal names; expand both sides before comparing.
const ABBR = [
  [/\butil\b/g, "utility"], [/\bdist\b/g, "district"], [/\bcoop\b/g, "cooperative"],
  [/\belec\b/g, "electric"], [/\bpwr\b/g, "power"], [/\bassn\b/g, "association"],
  [/\bmun\b/g, "municipal"], [/\bcomm\b/g, "commission"], [/\bauth\b/g, "authority"],
  [/\bdept\b/g, "department"], [/\bserv\b/g, "service"], [/\bsvcs?\b/g, "services"],
];
function norm(s) {
  let t = String(s || "").toLowerCase()
    .replace(/-\s*\([a-z]{2}\)\s*$/i, "")          // trailing "- (TX)"
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|llc|lp|ltd|corp|corporation|company|companies|co|and|of)\b/g, " ");
  for (const [re, to] of ABBR) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}
// Brand names that EIA files under a different legal name entirely.
const OVERRIDES = {
  "cps energy": { eia: "city of san antonio", state: "TX" },
  "austin energy": { eia: "city of austin", state: "TX" },
  "seattle city light": { eia: "city of seattle", state: "WA" },
  "silicon valley power": { eia: "city of santa clara", state: "CA" },
  "colorado springs utilities": { eia: "city of colorado springs", state: "CO" },
  "memphis light gas and water division": { eia: "city of memphis", state: "TN" },
  "nashville electric service": { eia: "city of nashville", state: "TN" },
};
const STATE_2 = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" };
const st2 = (s) => { const t = String(s || "").trim(); if (t.length === 2) return t.toUpperCase(); return STATE_2[t.toLowerCase()] || null; };

// ---------- 1) download + parse ----------
console.log(`Fetching EIA-861 ${YEAR}…`);
const resp = await fetch(`https://www.eia.gov/electricity/data/eia861/zip/f861${YEAR}.zip`);
if (!resp.ok) { console.error("Download failed:", resp.status); process.exit(1); }
const zip = new AdmZip(Buffer.from(await resp.arrayBuffer()));
const entry = zip.getEntries().map((e) => e.entryName).find((n) => /^sales_ult_cust_\d{4}\.xlsx$/i.test(n));
if (!entry) { console.error("Sales_Ult_Cust sheet not found in zip"); process.exit(1); }
const wb = XLSX.read(zip.readFile(entry), { type: "buffer" });
const rows = XLSX.utils.sheet_to_json(wb.Sheets["States"], { header: 1, raw: true });

// header layout (verified against the 2024 file): row0 = group labels
// (RESIDENTIAL/COMMERCIAL/INDUSTRIAL/…/TOTAL), row2 = column names, data row3+.
const groups = rows[0].map((v) => String(v || "").trim().toUpperCase());
const gi = (label) => groups.indexOf(label);
const G = { res: gi("RESIDENTIAL"), com: gi("COMMERCIAL"), ind: gi("INDUSTRIAL"), tot: gi("TOTAL") };
if (G.tot < 0) { console.error("TOTAL group not found — file layout changed:", groups.join(",")); process.exit(1); }
console.log(`parsed ${rows.length - 3} rows · groups res@${G.res} com@${G.com} ind@${G.ind} total@${G.tot}`);

// aggregate per utility number across states/parts
const utils = new Map();
for (const r of rows.slice(3)) {
  const num = r[1];
  if (typeof num !== "number") continue;
  const u = utils.get(num) ?? { name: String(r[2] || ""), states: new Set(), rev: 0, mwh: 0, cust: 0, g: { res: [0, 0], com: [0, 0], ind: [0, 0] } };
  u.states.add(String(r[6] || ""));
  const num0 = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  u.rev += num0(r[G.tot]); u.mwh += num0(r[G.tot + 1]); u.cust += num0(r[G.tot + 2]);
  for (const k of ["res", "com", "ind"]) if (G[k] >= 0) { u.g[k][0] += num0(r[G[k]]); u.g[k][1] += num0(r[G[k] + 2]); }
  utils.set(num, u);
}
console.log(`${utils.size} utilities aggregated`);

// name index: normalized EIA name -> [utilNum]
const byNorm = new Map();
for (const [numId, u] of utils) {
  const n = norm(u.name);
  if (!n) continue;
  (byNorm.get(n) ?? byNorm.set(n, []).get(n)).push(numId);
}

// ---------- 2) match directory entities ----------
const { data: ents } = await db.from("entities").select("id, canonical_name, hq_state, data_tier, eia_utility_id");
const { data: aliases } = await db.from("entity_aliases").select("entity_id, alias");
const aliasesOf = new Map();
for (const a of aliases ?? []) (aliasesOf.get(a.entity_id) ?? aliasesOf.set(a.entity_id, []).get(a.entity_id)).push(a.alias);

// A holding company spans MANY EIA utilities (Exelon = ComEd + PECO + BGE + …),
// so collect every match and SUM. Canonical-name matches are state-guarded;
// alias matches (opco legal names) are exact-normalized but unguarded (opcos
// operate outside the parent's HQ state).
function findUtils(ent) {
  const found = new Set();
  if (ent.eia_utility_id && utils.has(Number(ent.eia_utility_id))) found.add(Number(ent.eia_utility_id));
  const st = st2(ent.hq_state);
  const stateOk = (numId) => !st || utils.get(numId).states.has(st);
  const cn = norm(ent.canonical_name);
  const ov = OVERRIDES[cn];
  if (ov) {
    const hit = [...utils.entries()].find(([, u]) => norm(u.name) === norm(ov.eia) && u.states.has(ov.state));
    if (hit) found.add(hit[0]);
  }
  for (const numId of (byNorm.get(cn) ?? []).filter(stateOk)) found.add(numId);
  if (!found.size && cn.length >= 8) {
    // prefix either way (canonical only) — "…cooperative" vs "…cooperative association"
    const pref = [...byNorm.entries()]
      .filter(([en]) => en.startsWith(cn + " ") || cn.startsWith(en + " "))
      .flatMap(([, ids]) => ids).filter(stateOk);
    if (pref.length === 1) found.add(pref[0]);
  }
  for (const al of aliasesOf.get(ent.id) ?? []) {
    const n = norm(al);
    if (n.length < 8) continue;
    for (const numId of byNorm.get(n) ?? []) found.add(numId);
  }
  return [...found].filter((numId) => utils.get(numId).cust > 0);
}

let matched = 0, factRows = [];
const matchedPairs = [];
for (const ent of ents ?? []) {
  const numIds = findUtils(ent);
  if (!numIds.length) continue;
  const sum = { name: numIds.map((n) => utils.get(n).name).join(" + "), n: numIds.length, rev: 0, mwh: 0, cust: 0, g: { res: [0, 0], com: [0, 0], ind: [0, 0] } };
  for (const numId of numIds) {
    const u = utils.get(numId);
    sum.rev += u.rev; sum.mwh += u.mwh; sum.cust += u.cust;
    for (const k of ["res", "com", "ind"]) { sum.g[k][0] += u.g[k][0]; sum.g[k][1] += u.g[k][1]; }
  }
  if (!sum.cust && !sum.rev) continue;
  matched++;
  matchedPairs.push([ent, numIds, sum]);
  const push = (fact_key, value, unit) => { if (value != null && isFinite(value) && value !== 0) factRows.push({ entity_id: ent.id, source: "eia", fact_key, period: String(YEAR), value, unit, source_url: SRC_URL }); };
  push("customers", sum.cust, "count");
  push("sales_mwh", sum.mwh, "MWh");
  push("revenue", sum.rev / 1000, "USD_millions");
  push("utilities_count", sum.n, "count");
  push("res_revenue", sum.g.res[0] / 1000, "USD_millions"); push("res_customers", sum.g.res[1], "count");
  push("com_revenue", sum.g.com[0] / 1000, "USD_millions"); push("com_customers", sum.g.com[1], "count");
  push("ind_revenue", sum.g.ind[0] / 1000, "USD_millions"); push("ind_customers", sum.g.ind[1], "count");
}
console.log(`matched ${matched}/${(ents ?? []).length} directory entities · ${factRows.length} facts`);

// ---------- 3) write ----------
const ids = matchedPairs.map(([e]) => e.id);
for (let i = 0; i < ids.length; i += 100) await db.from("entity_facts").delete().in("entity_id", ids.slice(i, i + 100)).eq("source", "eia");
for (let i = 0; i < factRows.length; i += 400) {
  const { error } = await db.from("entity_facts").insert(factRows.slice(i, i + 400));
  if (error) { console.error("insert error:", error.message); process.exit(1); }
}
for (const [ent, numIds] of matchedPairs) {
  const upd = { eia_utility_id: String(numIds[0]) };
  if (ent.data_tier === "D" || ent.data_tier == null) upd.data_tier = "B";
  await db.from("entities").update(upd).eq("id", ent.id);
}

// named verification checklist — the entities a rep would actually look up
console.log("\nVerification checklist:");
const CHECK = ["Sacramento Municipal Utility District", "Los Angeles Department", "Salt River Project", "CPS Energy", "Austin Energy", "Pedernales", "JEA", "Seattle City Light", "EXELON", "Duke Energy", "NEXTERA", "AMERICAN ELECTRIC POWER"];
for (const q of CHECK) {
  const hit = matchedPairs.find(([e]) => e.canonical_name.toLowerCase().includes(q.toLowerCase().slice(0, 14)));
  if (hit) {
    const [ent, numIds, sum] = hit;
    console.log(`  ✓ ${ent.canonical_name.slice(0, 34).padEnd(34)} ${String(numIds.length).padStart(2)} util(s) · ${(sum.cust / 1e6).toFixed(2)}M cust · $${(sum.rev / 1e6).toFixed(2)}B`);
  } else console.log(`  ✗ ${q} — NOT matched`);
}
console.log(`\nDone. ${matched} entities now carry EIA-861 ${YEAR} ops data.`);
