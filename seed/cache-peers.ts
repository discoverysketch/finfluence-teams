// Warms the entity_facts cache for a universe of major US utilities/power companies
// so Peer Duel has a real candidate pool. One-time (7-day fresh); safe to re-run.
// Run: npm run cache-peers
import { createClient } from "@supabase/supabase-js";
import { fetchFinancials, type Financials } from "../lib/edgar.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });

const METRICS: (keyof Financials)[] = [
  "revenue", "operatingIncome", "netIncome", "interestExpense",
  "totalAssets", "totalLiabilities", "totalEquity",
  "cash", "currentAssets", "currentLiabilities",
  "totalDebt", "operatingCashFlow", "capex", "cogs",
];
const TICKERS = [
  "NEE", "DUK", "SO", "EXC", "D", "AEP", "XEL", "WEC", "ED", "PEG", "EIX", "PCG", "AEE",
  "CMS", "DTE", "ETR", "FE", "PPL", "CNP", "NI", "LNT", "EVRG", "ATO", "UTL", "SRE",
  "PNW", "IDA", "OGE", "POR", "BKH", "NWE", "AVA", "AES", "VST", "NRG",
];

let cached = 0;
for (const t of TICKERS) {
  let fin: Financials | null = null;
  try { fin = await fetchFinancials(t); } catch { /* below */ }
  if (!fin) { console.log(`  ${t}: no data`); continue; }
  const { data: ent } = await db.from("entities").select("id").eq("cik", fin.cik).maybeSingle();
  if (!ent) { console.log(`  ${t}: not in directory`); continue; }

  const source_url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${fin.cik}&type=10-K&count=10`;
  const rows = METRICS.filter((k) => fin![k] != null)
    .map((k) => ({ entity_id: ent.id, source: "sec", fact_key: k as string, period: fin!.period, value: fin![k] as number, unit: "USD_millions", source_url }));
  await db.from("entity_facts").delete().eq("entity_id", ent.id).eq("source", "sec");
  if (rows.length) await db.from("entity_facts").insert(rows);
  await db.from("entities").update({ entity_type: "iou" }).eq("id", ent.id).is("entity_type", null);
  cached++;
  console.log(`  ${t}: ${rows.length} facts (${fin.period})`);
}
console.log(`\nDone. Warmed ${cached}/${TICKERS.length} peers.`);
