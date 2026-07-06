// Warms the shared directory with municipal energy & water utilities and notable
// clean-energy companies (mostly non-SEC / Tier D), so reps match them instantly
// instead of waiting on live web research. Curated from Claude's knowledge (fast,
// no web search) and clearly labeled unverified — the Research button still adds
// sourced detail on demand. Idempotent. Run: npm run warm-directory
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing URL / service key in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const claude = new Anthropic();

const TYPES = ["iou", "ipp", "coop", "muni", "retailer", "other"];
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    entities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          canonical_name: { type: "string" },
          acronym: { type: "string" },
          entity_type: { type: "string", enum: TYPES },
          hq_state: { type: "string" },
          sector: { type: "string" },
          blurb: { type: "string" },
        },
        required: ["canonical_name", "acronym", "entity_type", "hq_state", "sector", "blurb"],
      },
    },
  },
  required: ["entities"],
};

async function gen(prompt: string): Promise<any[]> {
  const res = await claude.messages.create({
    model: "claude-opus-4-8", max_tokens: 8000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
  return JSON.parse(text).entities || [];
}

console.log("Asking Claude for the lists…");
const ACRO = "acronym = the common short code it's known by (e.g., SMUD, LADWP, CPS, JEA, OUC, MLGW, SRP), or empty string if none. ";
const [energy, water, clean] = await Promise.all([
  gen("List the ~60 largest US municipal and public-power ELECTRIC and/or GAS utilities — city-owned utilities, public utility districts, and state/regional public power authorities — that are NOT SEC-registered public companies. entity_type: 'muni' for city/public-power/authority, 'coop' for cooperatives, else 'other'. hq_state = 2-letter code. sector = 'electric', 'gas', or 'electric & gas'. " + ACRO + "blurb = one line (who they serve + rough size). Use official names."),
  gen("List the ~40 largest US municipal WATER and/or wastewater utilities (city water departments, regional water authorities/districts) that are NOT SEC-registered public companies. entity_type = 'muni' (or 'other'). hq_state = 2-letter. sector = 'water'. " + ACRO + "blurb = one line."),
  gen("List ~30 notable US clean-energy / renewables companies, prioritizing PRIVATELY-HELD developers and independent power producers (solar/wind/storage/geothermal) rather than large SEC-listed public companies. entity_type = 'ipp' or 'other'. hq_state = 2-letter (best guess of HQ). sector = 'clean energy'. " + ACRO + "blurb = one line."),
]);

const seen = new Set<string>();
const all = [...energy, ...water, ...clean].filter((e) => {
  const k = (e.canonical_name || "").trim().toLowerCase();
  if (!k || seen.has(k)) return false; seen.add(k); return true;
});
console.log(`Generated ${energy.length} energy + ${water.length} water + ${clean.length} clean = ${all.length} unique.`);

// Clear prior curated rows so re-runs stay clean.
await db.from("entities").delete().is("created_by_tenant", null).eq("data_tier", "D").filter("profile_json->>source", "eq", "curated");

// Existing tickers (mostly SEC) — never reuse one as a muni acronym.
const { data: tk } = await db.from("entities").select("ticker").not("ticker", "is", null);
const takenTickers = new Set((tk ?? []).map((r: any) => String(r.ticker).toUpperCase()));

let inserted = 0, skipped = 0;
for (const e of all) {
  // Skip if the directory already has a close match (e.g. an SEC filer).
  const { data: m } = await db.rpc("match_entities", { q: e.canonical_name, lim: 1 });
  if (m && m[0] && m[0].score >= 0.85) { skipped++; continue; }
  const entity_type = TYPES.includes(e.entity_type) ? e.entity_type : "other";
  // Store the common acronym in `ticker` so exact-match search finds it (munis have no real ticker).
  const acro = String(e.acronym || "").trim().toUpperCase();
  let ticker: string | null = null;
  if (acro.length >= 3 && acro.length <= 8 && /^[A-Z0-9&-]+$/.test(acro) && !takenTickers.has(acro)) { ticker = acro; takenTickers.add(acro); }
  const profile_json = {
    canonical_name: e.canonical_name, entity_type, hq_state: e.hq_state || "",
    segment: e.sector || "", summary: e.blurb || "", ownership: "", est_size: "",
    sources: [], confidence: "low", source: "curated",
    note: "Curated list entry — unverified. Use Research for a sourced profile.",
  };
  const { error } = await db.from("entities").insert({
    canonical_name: e.canonical_name, entity_type, hq_state: e.hq_state || null,
    ticker, data_tier: "D", created_by_tenant: null, profile_json,
  });
  if (error) { console.log(`  skip ${e.canonical_name}: ${error.message}`); skipped++; }
  else inserted++;
}
console.log(`\nDone. Inserted ${inserted}, skipped ${skipped} (already in directory or errored).`);
