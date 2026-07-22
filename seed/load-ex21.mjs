// Harvest subsidiary names from SEC Exhibit 21 (the legally required
// subsidiaries list in every 10-K) for entities held as accounts, and store
// them as entity_aliases (source 'sec' (Ex-21)) pointing at the parent. This is what
// makes a rep's spreadsheet of opco names ("Duke Energy Ohio") resolve to the
// right parent, and powers the Hub's corporate-family view.
// Run: node --env-file=.env.local seed/load-ex21.mjs
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.ANTHROPIC_API_KEY) { console.error("Missing env"); process.exit(1); }
const db = createClient(url, key, { auth: { persistSession: false } });
const anthropic = new Anthropic();
const UA = { "User-Agent": "AccountFluency dan.wain1@gmail.com" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { subs: { type: "array", items: { type: "string" } } },
  required: ["subs"],
};

async function ex21For(cik) {
  const pad = String(cik).padStart(10, "0");
  const r = await fetch(`https://data.sec.gov/submissions/CIK${pad}.json`, { headers: UA });
  if (!r.ok) return null;
  const j = await r.json();
  const rec = j?.filings?.recent;
  if (!rec?.form) return null;
  let acc = null;
  for (let i = 0; i < rec.form.length; i++) if (rec.form[i] === "10-K") { acc = rec.accessionNumber[i]; break; }
  if (!acc) return null;
  const nodash = acc.replace(/-/g, "");
  // The -index.htm page lists exhibit types; find the EX-21 row's href.
  const idx = await fetch(`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${nodash}/${acc}-index.htm`, { headers: UA });
  if (!idx.ok) return null;
  const html = await idx.text();
  const m = html.match(/href="([^"]+)"[^>]*>[^<]*<\/a><\/td>\s*<td[^>]*>EX-21/i)
    || html.match(/<a href="([^"]+\.htm[^"]*)"[^>]*>[^<]*ex[-_.]?21[^<]*<\/a>/i)
    || (html.match(/<tr[^>]*>[\s\S]*?EX-21[\s\S]*?<\/tr>/i)?.[0] ?? "").match(/href="([^"]+)"/i);
  if (!m) return null;
  let href = m[1];
  if (href.startsWith("/")) href = `https://www.sec.gov${href}`;
  else if (!href.startsWith("http")) href = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${nodash}/${href}`;
  href = href.replace("/ix?doc=/", "/"); // inline-XBRL viewer wrapper
  const doc = await fetch(href, { headers: UA });
  if (!doc.ok) return null;
  const text = (await doc.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ").slice(0, 60000);
  return text.length > 200 ? text : null;
}

const { data: accts } = await db.from("accounts").select("entity:entities(id, canonical_name, cik)");
const parents = [...new Map((accts ?? []).filter((a) => a.entity?.cik).map((a) => [a.entity.id, a.entity])).values()];
console.log(`parents with CIK: ${parents.length}`);

const { data: existing } = await db.from("entity_aliases").select("entity_id, alias");
const have = new Set((existing ?? []).map((a) => `${a.entity_id}:${a.alias.toLowerCase()}`));

let totalAdded = 0;
for (const ent of parents) {
  try {
    const text = await ex21For(ent.cik);
    if (!text) { console.log(`  – ${ent.canonical_name.slice(0, 36)}: no Ex-21 found`); continue; }
    const res = await anthropic.messages.create({
      model: "claude-sonnet-5", max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system:
        "Extract SUBSIDIARY COMPANY NAMES from this SEC Exhibit 21 (subsidiaries list). " +
        "Return each subsidiary's name exactly as written (without the state/jurisdiction column). " +
        "Skip the parent company itself, headings, jurisdictions, and footnotes. Up to 250 names.",
      messages: [{ role: "user", content: text }],
    });
    const out = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => b.text).join(""));
    const subs = (out.subs ?? [])
      .map((s) => String(s).trim().replace(/\s+/g, " "))
      .filter((s) => s.length >= 10 && s.length <= 90 && /[a-z]/i.test(s))
      .filter((s) => s.toLowerCase() !== ent.canonical_name.toLowerCase());
    const rows = [...new Set(subs)].filter((s) => !have.has(`${ent.id}:${s.toLowerCase()}`))
      .map((alias) => ({ entity_id: ent.id, alias, source: "sec" }));
    let inserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error } = await db.from("entity_aliases").insert(rows.slice(i, i + 200));
      if (error) { console.log(`  ! ${ent.canonical_name.slice(0, 30)}: ${error.message}`); break; }
      inserted += Math.min(200, rows.length - i);
    }
    rows.forEach((r) => have.add(`${r.entity_id}:${r.alias.toLowerCase()}`));
    totalAdded += inserted;
    console.log(`  ✓ ${ent.canonical_name.slice(0, 36).padEnd(36)} ${subs.length} subs, ${inserted} inserted`);
    await sleep(300);
  } catch (e) { console.log(`  ! ${ent.canonical_name.slice(0, 30)}: ${e.message}`); }
}
console.log(`\nDone. ${totalAdded} subsidiary aliases added (source 'sec' (Ex-21)).`);
