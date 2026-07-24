// Loads EIA-860 (annual generator inventory) into entities.fleet_json for
// entities in the directory. Aggregates every operating generator by fuel and
// plant, sums across a holding company's operating subsidiaries (via Ex-21
// aliases), and writes the SAME shape DeepIntel renders — so the bulk load is
// instant, complete, and consistent, while the on-demand web research stays a
// re-run option. Idempotent; annual. Run: npm run load-eia860
import AdmZip from "adm-zip";
import XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing URL / service key in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const YEAR = 2024;
const SRC_URL = "https://www.eia.gov/electricity/data/eia860/";

// --- name normalization (shared approach with load-eia.mjs) ---
const ABBR = [
  [/\butil\b/g, "utility"], [/\bdist\b/g, "district"], [/\bcoop\b/g, "cooperative"],
  [/\belec\b/g, "electric"], [/\bpwr\b/g, "power"], [/\bassn\b/g, "association"],
  [/\bmun\b/g, "municipal"], [/\bcomm\b/g, "commission"], [/\bauth\b/g, "authority"],
  [/\bdept\b/g, "department"], [/\bserv\b/g, "service"], [/\bsvcs?\b/g, "services"],
];
function norm(s) {
  let t = String(s || "").toLowerCase()
    .replace(/-\s*\([a-z]{2}\)\s*$/i, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\b(the|inc|llc|lp|ltd|corp|corporation|company|companies|co|and|of)\b/g, " ");
  for (const [re, to] of ABBR) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}
const STATE_2 = { alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY" };
const st2 = (s) => { const t = String(s || "").trim(); if (t.length === 2) return t.toUpperCase(); return STATE_2[t.toLowerCase()] || null; };

// --- fuel categorization from EIA energy-source code / technology ---
const COAL = new Set(["ANT", "BIT", "LIG", "SUB", "WC", "RC", "SGC"]);
const GAS = new Set(["NG", "BFG", "OG", "PG", "SGP"]);
const OIL = new Set(["DFO", "RFO", "JF", "KER", "PC", "WO"]);
const BIO = new Set(["WDS", "WDL", "AB", "OBS", "SLW", "BLQ", "OBL", "OBG", "MSW", "MSB", "MSN", "TDF", "WH", "LFG"]);
function fuelCat(es, tech, pm) {
  const t = String(tech || "").toLowerCase();
  if (/batter|energy storage|flywheel|compressed air/.test(t) || pm === "BA") return "Storage";
  const c = String(es || "").toUpperCase().trim();
  if (COAL.has(c)) return "Coal";
  if (GAS.has(c)) return "Gas";
  if (OIL.has(c)) return "Oil";
  if (c === "NUC") return "Nuclear";
  if (c === "WAT") return "Hydro";
  if (c === "WND") return "Wind";
  if (c === "SUN") return "Solar";
  if (c === "GEO") return "Geothermal";
  if (c === "MWH") return "Storage";
  if (BIO.has(c)) return "Biomass";
  return "Other";
}

// ---------- 1) download + parse ----------
async function grab(urls) {
  for (const u of urls) {
    try { const r = await fetch(u); if (r.ok) { console.log(`  ↓ ${u}`); return Buffer.from(await r.arrayBuffer()); } } catch { /* try next */ }
  }
  return null;
}
console.log(`Fetching EIA-860 ${YEAR}…`);
const buf = await grab([
  `https://www.eia.gov/electricity/data/eia860/xls/eia860${YEAR}.zip`,
  `https://www.eia.gov/electricity/data/eia860/archive/xls/eia860${YEAR}.zip`,
  `https://www.eia.gov/electricity/data/eia860/archive/xls/eia860${YEAR - 1}.zip`,
]);
if (!buf) { console.error("Download failed for all candidate URLs"); process.exit(1); }
const zip = new AdmZip(buf);
const genName = zip.getEntries().map((e) => e.entryName).find((n) => /(^|\/)3_1_Generator_Y\d{4}\.xlsx$/i.test(n));
if (!genName) { console.error("3_1_Generator sheet not found in zip:", zip.getEntries().map((e) => e.entryName).join(", ")); process.exit(1); }
const wb = XLSX.read(zip.readFile(genName), { type: "buffer" });
const sheetName = wb.SheetNames.find((s) => /operable/i.test(s)) || wb.SheetNames[0];
const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: true });

// EIA-860 sheets carry a title/note row before the header; find the header row.
const clean = (v) => String(v || "").replace(/\s+/g, " ").trim();
let hdrIdx = rows.findIndex((r) => (r || []).some((c) => /nameplate capacity/i.test(clean(c))));
if (hdrIdx < 0) { console.error("Header row (Nameplate Capacity) not found — file layout changed"); process.exit(1); }
const hdr = rows[hdrIdx].map(clean);
const col = (want) => hdr.findIndex((h) => h.toLowerCase() === want.toLowerCase());
const colInc = (want) => hdr.findIndex((h) => h.toLowerCase().includes(want.toLowerCase()));
const C = {
  uid: col("Utility ID"), uname: col("Utility Name"), plant: col("Plant Name"), state: col("State"),
  tech: col("Technology"), pm: col("Prime Mover"), mw: colInc("Nameplate Capacity"),
  es1: col("Energy Source 1"), status: col("Status"),
};
if (C.uid < 0 || C.uname < 0 || C.mw < 0) { console.error("Required columns missing", C, hdr.join(" | ")); process.exit(1); }
console.log(`sheet "${sheetName}" · header@${hdrIdx} · ${rows.length - hdrIdx - 1} generator rows`);

// aggregate per EIA Utility ID
const utils = new Map(); // uid -> { name, states:Set, mw, byFuel:Map, plants:Map(name->{mw,fuel:Map}) }
for (const r of rows.slice(hdrIdx + 1)) {
  const uid = r[C.uid];
  if (uid == null || uid === "") continue;
  const mw = Number(r[C.mw]);
  if (!isFinite(mw) || mw <= 0) continue;
  const status = C.status >= 0 ? String(r[C.status] || "").toUpperCase() : "OP";
  if (status && !/^(OP|SB|OA)/.test(status)) continue; // operating / standby / soon-return only
  const fuel = fuelCat(r[C.es1], r[C.tech], String(r[C.pm] || "").toUpperCase());
  const u = utils.get(uid) ?? { name: clean(r[C.uname]), states: new Set(), mw: 0, byFuel: new Map(), plants: new Map() };
  u.mw += mw;
  u.byFuel.set(fuel, (u.byFuel.get(fuel) || 0) + mw);
  if (C.state >= 0) u.states.add(String(r[C.state] || "").toUpperCase());
  const pn = clean(r[C.plant]) || "—";
  const p = u.plants.get(pn) ?? { mw: 0, fuel: new Map() };
  p.mw += mw; p.fuel.set(fuel, (p.fuel.get(fuel) || 0) + mw);
  u.plants.set(pn, p);
  utils.set(uid, u);
}
console.log(`${utils.size} operating utilities · ${[...utils.values()].reduce((a, u) => a + u.mw, 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} MW total`);

// name index: normalized EIA utility name -> [uid]
const byNorm = new Map();
for (const [uid, u] of utils) {
  const n = norm(u.name);
  if (!n) continue;
  (byNorm.get(n) ?? byNorm.set(n, []).get(n)).push(uid);
}

// ---------- 2) match directory entities (mirrors load-eia findUtils) ----------
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
const ents = await allEntities("id, canonical_name, hq_state");
const { data: aliases } = await db.from("entity_aliases").select("entity_id, alias");
const aliasesOf = new Map();
for (const a of aliases ?? []) (aliasesOf.get(a.entity_id) ?? aliasesOf.set(a.entity_id, []).get(a.entity_id)).push(a.alias);

function findUtils(ent) {
  const found = new Set();
  const st = st2(ent.hq_state);
  const cn = norm(ent.canonical_name);
  // Canonical-name match is state-guarded; alias (opco legal name) is unguarded.
  for (const uid of byNorm.get(cn) ?? []) if (!st || utils.get(uid).states.has(st)) found.add(uid);
  if (!found.size && cn.length >= 8) {
    const pref = [...byNorm.entries()]
      .filter(([en]) => en.startsWith(cn + " ") || cn.startsWith(en + " "))
      .flatMap(([, ids]) => ids).filter((uid) => !st || utils.get(uid).states.has(st));
    if (pref.length === 1) found.add(pref[0]);
  }
  for (const al of aliasesOf.get(ent.id) ?? []) {
    const n = norm(al);
    if (n.length < 8) continue;
    for (const uid of byNorm.get(n) ?? []) found.add(uid);
  }
  return [...found];
}

const FUEL_ORDER = ["Nuclear", "Coal", "Gas", "Oil", "Hydro", "Wind", "Solar", "Geothermal", "Biomass", "Storage", "Other"];
let matched = 0;
const updates = [];
for (const ent of ents ?? []) {
  const uids = findUtils(ent);
  if (!uids.length) continue;
  const byFuel = new Map(); const plants = new Map(); const states = new Set();
  let mw = 0, genCount = 0;
  for (const uid of uids) {
    const u = utils.get(uid); mw += u.mw;
    for (const [f, v] of u.byFuel) byFuel.set(f, (byFuel.get(f) || 0) + v);
    for (const s of u.states) states.add(s);
    for (const [pn, p] of u.plants) {
      const ex = plants.get(pn) ?? { mw: 0, fuel: new Map() };
      ex.mw += p.mw; for (const [f, v] of p.fuel) ex.fuel.set(f, (ex.fuel.get(f) || 0) + v);
      plants.set(pn, ex); genCount++;
    }
  }
  if (mw < 1) continue; // sub-1 MW = a T&D company with an incidental asset, not a generating fleet
  matched++;
  const mix = [...byFuel.entries()].map(([fuel, v]) => ({ fuel, share_pct: Math.round((v / mw) * 1000) / 10 }))
    .filter((x) => x.share_pct >= 0.5).sort((a, b) => b.share_pct - a.share_pct);
  const domOf = (p) => [...p.fuel.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const notable = [...plants.entries()].sort((a, b) => b[1].mw - a[1].mw).slice(0, 4)
    .map(([pn, p]) => `${pn} — ${Math.round(p.mw).toLocaleString()} MW ${domOf(p)}`);
  const topFuels = mix.slice(0, 3).map((x) => `${x.fuel} ${x.share_pct}%`).join(", ");
  const summary = `Operating fleet of ≈${Math.round(mw).toLocaleString()} MW across ${plants.size} plant${plants.size === 1 ? "" : "s"}` +
    ` in ${[...states].sort().join(", ") || "—"} (EIA-860, ${YEAR}). Capacity by fuel: ${topFuels}.`;
  const fleet = {
    summary, total_mw: Math.round(mw),
    mix: mix.map((x) => ({ fuel: x.fuel, share_pct: x.share_pct })),
    notable,
    source: SRC_URL, // DeepIntel uses this as an href — keep it a clean URL; year is in summary
    via: "eia860", // provenance marker: distinguishes bulk-loaded fleet from on-demand web research
  };
  updates.push({ ent, fleet, mw, plants: plants.size, uids: uids.length });
}
console.log(`matched ${matched}/${(ents ?? []).length} directory entities with generation`);

// ---------- 3) write fleet_json ----------
// Clear prior bulk writes first so entities that dropped below the generation
// floor this run don't keep stale fleet cards. Keyed on the EIA-860 source URL
// (set only by this loader) — on-demand web-researched fleet cites specific
// pages, so it's left untouched.
await db.from("entities").update({ fleet_json: null, fleet_at: null }).eq("fleet_json->>source", SRC_URL);
const nowIso = new Date().toISOString();
for (const { ent, fleet } of updates) {
  const { error } = await db.from("entities").update({ fleet_json: fleet, fleet_at: nowIso }).eq("id", ent.id);
  if (error) console.log(`  ! ${ent.canonical_name.slice(0, 30)}: ${error.message}`);
}

// verification checklist — accounts a rep would actually look up
console.log("\nVerification checklist:");
const CHECK = ["Duke Energy", "Southern Company", "NextEra", "American Electric Power", "Exelon", "Dominion", "Xcel", "Entergy", "PG&E", "Vistra", "Salt River Project", "Nebraska Public Power"];
for (const q of CHECK) {
  const hit = updates.find(({ ent }) => ent.canonical_name.toLowerCase().includes(q.toLowerCase().slice(0, 12)));
  if (hit) console.log(`  ✓ ${hit.ent.canonical_name.slice(0, 32).padEnd(32)} ${String(hit.uids).padStart(2)} util(s) · ${(hit.mw / 1000).toFixed(1)} GW · ${hit.plants} plants · ${hit.fleet.mix.slice(0, 3).map((m) => `${m.fuel} ${m.share_pct}%`).join(" ")}`);
  else console.log(`  ✗ ${q} — no generation matched`);
}
console.log(`\nDone. ${matched} entities now carry EIA-860 ${YEAR} fleet data (entities.fleet_json).`);
