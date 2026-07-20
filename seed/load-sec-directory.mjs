// Loads the SEC company_tickers.json directory into the SHARED entities table
// (created_by_tenant = null, data_tier = 'A'). One-time batch job; idempotent via
// upsert on cik. Run: npm run load-directory
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

console.log("Fetching SEC company_tickers.json…");
const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
  headers: { "User-Agent": "AccountFluency dan.wain1@gmail.com" }, // SEC requires a contact UA
});
if (!res.ok) { console.error("SEC fetch failed:", res.status); process.exit(1); }
const json = await res.json();

const rows = Object.values(json)
  .filter((c) => c && c.title && c.cik_str != null)
  .map((c) => ({
    canonical_name: String(c.title).trim(),
    ticker: c.ticker ? String(c.ticker).trim() : null,
    cik: String(c.cik_str).padStart(10, "0"),
    data_tier: "A",
    created_by_tenant: null,
  }));

// Some CIKs appear twice (multiple share-class tickers). Keep one row per CIK
// so a single upsert batch never touches the same row twice.
const byCik = new Map();
for (const r of rows) if (!byCik.has(r.cik)) byCik.set(r.cik, r);
const deduped = [...byCik.values()];

console.log(`Fetched ${rows.length} SEC filers (${deduped.length} unique CIKs). Upserting into the shared directory…`);
let done = 0;
for (let i = 0; i < deduped.length; i += 500) {
  const chunk = deduped.slice(i, i + 500);
  const { error } = await db.from("entities").upsert(chunk, { onConflict: "cik" });
  if (error) { console.error("\nUpsert error near row", i, "-", error.message); process.exit(1); }
  done += chunk.length;
  process.stdout.write(`\r  ${done}/${deduped.length}`);
}
console.log(`\nDone. ${deduped.length} tier-A entities in the shared directory.`);
