// Seeds entity_aliases with subsidiary / brand / former-name / abbreviation
// mappings to SEC-registered parents, so intake matches "NYSEG", "Duracell",
// "Vistra Energy", "Vectren", etc. Curated from Claude's knowledge; parents are
// resolved against the live directory (ticker first, fuzzy name fallback).
// Idempotent (replaces source='curated' rows). Run: npm run seed-aliases
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing URL / service key in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const claude = new Anthropic();

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    pairs: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          alias: { type: "string" },
          parent_ticker: { type: "string" },
          parent_name: { type: "string" },
        },
        required: ["alias", "parent_ticker", "parent_name"],
      },
    },
  },
  required: ["pairs"],
};

async function gen(prompt: string): Promise<any[]> {
  const res = await claude.messages.create({
    model: "claude-opus-4-8", max_tokens: 12000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
    messages: [{ role: "user", content: prompt }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
  return JSON.parse(text).pairs || [];
}

const RULES =
  "Only include mappings you are confident are CURRENT (as of your knowledge). parent_ticker = the SEC ticker of the ultimate US-listed parent. " +
  "alias = the name a sales rep would type. Include for each parent: operating subsidiaries, retail brands, former/legacy names, and common abbreviations. " +
  "Do NOT invent; skip anything uncertain.";

console.log("Asking Claude for alias mappings…");
const [utils, retail, brk] = await Promise.all([
  gen(`List alias→parent mappings for MAJOR US INVESTOR-OWNED UTILITY holding companies and their operating utilities/legacy names. Examples of the pattern: Georgia Power→SO, ComEd→EXC, PECO→EXC, BGE→EXC, Pepco→EXC, Oklahoma Gas & Electric→OGE, Vectren→CNP, Southern Indiana Gas and Electric→CNP, Public Service Company of New Mexico→TXNM, Texas New Mexico Power→TXNM, PNM Resources→TXNM, NYSEG→AGR, Rochester Gas and Electric→AGR, Central Maine Power→AGR, We Energies→WEC, PSE&G→PEG, SCE/Southern California Edison→EIX, SDG&E→SRE, SoCalGas→SRE, Oncor→SRE, FPL/Florida Power & Light→NEE, Appalachian Power→AEP, SWEPCO→AEP, Public Service Company of Oklahoma→AEP, Ohio Edison→FE, Met-Ed→FE, Westar Energy→EVRG, KCP&L→EVRG, NSTAR→ES, Connecticut Light & Power→ES, Piedmont Natural Gas→DUK, New Jersey Natural Gas→NJR, Entergy Louisiana→ETR, AES Ohio→AES, DTE Electric→DTE. Cover ~35 holding companies thoroughly (~180 pairs). ${RULES}`),
  gen(`List alias→parent mappings for US POWER GENERATION & RETAIL ENERGY companies. Pattern examples: Vistra Energy→VST, TXU Energy→VST, Luminant→VST, Dynegy→VST, Ambit Energy→VST, Energy Harbor→VST, Reliant Energy→NRG, Green Mountain Energy→NRG, Direct Energy→NRG, XOOM Energy→NRG, Vivint→NRG, Cirro Energy→NRG, Constellation NewEnergy→CEG, Talen→TLN. ~40 pairs. ${RULES}`),
  gen(`List alias→parent mappings for BERKSHIRE HATHAWAY (parent_ticker BRK-B) subsidiaries a B2B rep might have as accounts: Duracell, The Pampered Chef, Business Wire, Acme Brick, Justin Brands, Fechheimer Brothers, Larson-Juhl, H.H. Brown, Brooks Sports, CORT, TTI Inc, Mouser Electronics, Sager Electronics, Shaw Industries, Clayton Homes, Forest River, Precision Castparts, Lubrizol, Marmon, MidAmerican Energy, PacifiCorp, NV Energy, BNSF, GEICO, Benjamin Moore, Dairy Queen, Fruit of the Loom, Garan, Jazwares, McLane, NetJets, Oriental Trading, Richline, Scott Fetzer, See's Candies, Star Furniture, TTI, Wells Lamont, XTRA Lease, Berkshire Hathaway Energy, Berkshire Hathaway HomeServices. ~45 pairs, all parent_ticker BRK-B. ${RULES}`),
]);

const pairs = [...utils, ...retail, ...brk];
console.log(`Generated ${pairs.length} pairs (${utils.length} utility + ${retail.length} gen/retail + ${brk.length} Berkshire).`);

// Resolve parents: exact ticker map first, fuzzy name fallback.
const { data: tk } = await db.from("entities").select("id,ticker,canonical_name").not("ticker", "is", null);
const byTicker = new Map((tk ?? []).map((r: any) => [String(r.ticker).toUpperCase(), r]));
const nameCache = new Map<string, any>();

async function resolveParent(p: any) {
  const t = String(p.parent_ticker || "").toUpperCase().replace(/\./g, "-").trim();
  if (byTicker.has(t)) return byTicker.get(t);
  const key = String(p.parent_name || "").toLowerCase();
  if (nameCache.has(key)) return nameCache.get(key);
  const { data } = await db.rpc("match_entities", { q: p.parent_name, lim: 1 });
  const hit = data?.[0] && data[0].score >= 0.6 ? data[0] : null;
  nameCache.set(key, hit);
  return hit;
}

await db.from("entity_aliases").delete().eq("source", "curated");
const seen = new Set<string>();
const rows: any[] = [];
let unresolved = 0;
for (const p of pairs) {
  const alias = String(p.alias || "").trim();
  if (alias.length < 2) continue;
  const parent = await resolveParent(p);
  if (!parent) { unresolved++; continue; }
  if (alias.toLowerCase() === String(parent.canonical_name).toLowerCase()) continue; // pointless
  const k = `${parent.id}|${alias.toLowerCase()}`;
  if (seen.has(k)) continue; seen.add(k);
  rows.push({ entity_id: parent.id, alias, source: "curated" });
}
for (let i = 0; i < rows.length; i += 200) {
  const { error } = await db.from("entity_aliases").insert(rows.slice(i, i + 200));
  if (error) { console.error("insert error:", error.message); process.exit(1); }
}
console.log(`Inserted ${rows.length} aliases (${unresolved} pairs skipped — parent not in directory).`);
