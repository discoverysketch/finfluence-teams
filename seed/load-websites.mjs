// Backfills entities.website for the book. Hand-checked domains, several
// verified by search because the obvious guess was wrong — FTAI Infrastructure
// is fipinc.com (not ftaiinfrastructure.com) and H2O America is h2o-america.com
// (hyphenated). Idempotent; only fills blanks unless --force.
// Run: npm run load-websites
import { createClient } from "@supabase/supabase-js";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const FORCE = process.argv.includes("--force");

// Matched against the canonical name, first hit wins. Order matters where one
// name contains another (National Grid Renewables before National Grid plc).
const SITES = [
  [/consolidated edison/i, "coned.com"],
  [/american electric power/i, "aep.com"],
  [/duke energy/i, "duke-energy.com"],
  [/southern co/i, "southerncompany.com"],
  [/public service enterprise/i, "pseg.com"],
  [/national grid renewables/i, "nationalgridrenewables.com"],
  [/national grid plc/i, "nationalgrid.com"],
  [/dominion energy/i, "dominionenergy.com"],
  [/firstenergy/i, "firstenergycorp.com"],
  [/nisource/i, "nisource.com"],
  [/evergy/i, "evergy.com"],
  [/ameren/i, "ameren.com"],
  [/xcel energy/i, "xcelenergy.com"],
  [/entergy/i, "entergy.com"],
  [/exelon/i, "exeloncorp.com"],
  [/eversource/i, "eversource.com"],
  [/centerpoint/i, "centerpointenergy.com"],
  [/constellation energy/i, "constellationenergy.com"],
  [/edison international/i, "edison.com"],
  [/dte energy/i, "dteenergy.com"],
  [/\baes\b/i, "aes.com"],
  [/avista/i, "avistacorp.com"],
  [/unitil/i, "unitil.com"],
  [/chesapeake utilities/i, "chesapeakeutilities.com"],
  [/spire inc/i, "spireenergy.com"],
  [/talen energy/i, "talenenergy.com"],
  [/ormat/i, "ormat.com"],
  [/clean energy fuels/i, "cleanenergyfuels.com"],
  [/rgc resources/i, "rgcresources.com"],          // verified
  [/h2o america/i, "h2o-america.com"],             // verified — hyphenated
  [/ftai infrastructure/i, "fipinc.com"],          // verified — not ftaiinfrastructure.com
  [/ranger energy/i, "rangerenergy.com"],
  [/core laboratories/i, "corelab.com"],
  [/genuine parts/i, "genpt.com"],
  [/avery dennison/i, "averydennison.com"],
  [/dick's sporting/i, "dickssportinggoods.com"],
  [/hinge health/i, "hingehealth.com"],
  [/x-energy/i, "x-energy.com"],
  [/scout clean energy/i, "scoutcleanenergy.com"],
  [/apex clean energy/i, "apexcleanenergy.com"],
  [/rwe/i, "rwe.com"],
  [/santee cooper|south carolina public service/i, "santeecooper.com"],
  [/colorado springs/i, "csu.org"],
  [/long island power/i, "lipower.org"],
  [/\bjea\b/i, "jea.com"],
  [/fleet farm/i, "fleetfarm.com"],
];

const { data: accts } = await db.from("accounts").select("entity:entities(id, canonical_name, ticker, website)");
const ents = [...new Map((accts ?? []).filter((a) => a.entity).map((a) => [a.entity.id, a.entity])).values()];

let set = 0, kept = 0, none = 0;
for (const e of ents) {
  if (e.website && !FORCE) { kept++; continue; }
  const hit = SITES.find(([re]) => re.test(e.canonical_name));
  if (!hit) { none++; console.log(`  – ${String(e.ticker ?? "—").padEnd(6)} ${e.canonical_name.slice(0, 34)} (no site on file)`); continue; }
  const { error } = await db.from("entities").update({ website: hit[1] }).eq("id", e.id);
  if (error) { console.log(`  ! ${e.canonical_name.slice(0, 30)}: ${error.message}`); continue; }
  set++;
  console.log(`  ✓ ${String(e.ticker ?? "—").padEnd(6)} ${e.canonical_name.slice(0, 34).padEnd(35)} ${hit[1]}`);
}
console.log(`\n${set} set · ${kept} already had one · ${none} still without (they render a monogram)`);
