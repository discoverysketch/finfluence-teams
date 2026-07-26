// Free, structured hiring signals straight from each company's ATS.
//
// Resolution is layered, cheapest first: a tenant we already stored, then any
// ATS URL left behind by earlier research, then a homepage crawl. Whatever
// resolves is saved, so discovery is a one-time cost per account and the book
// gets cheaper to refresh over time. Anything unresolved keeps using the
// existing web-search path.
//
//   node --env-file=.env.local --experimental-strip-types seed/load-jobs.ts [--dry] [--limit=N]
import { createClient } from "@supabase/supabase-js";
import { identify, discover, fetchFeed, oracleDetail, workdayDetail, scanPostings, type Posting } from "../lib/ats.ts";
/* eslint-disable @typescript-eslint/no-explicit-any */

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const DRY = process.argv.includes("--dry");
const LIMIT = Number((process.argv.find((a) => a.startsWith("--limit=")) ?? "").split("=")[1] || 0);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Works before or after migration 0030: fall back to the columns that exist.
const FULL = "entity:entities(id, canonical_name, ticker, website, ats_platform, ats_url, hiring_json, stack_json, profile_json, priorities_json)";
const BASE = "entity:entities(id, canonical_name, ticker, website, hiring_json, stack_json, profile_json, priorities_json)";
let res = await db.from("accounts").select(FULL);
let hasAtsCols = !res.error;
if (res.error) { res = await db.from("accounts").select(BASE); console.log("(ats_* columns not present yet - running read-only)"); }
const data = res.data;
let ents = [...new Map((data ?? []).filter((a: any) => a.entity).map((a: any) => [a.entity.id, a.entity])).values()] as any[];
if (LIMIT) ents = ents.slice(0, LIMIT);
console.log(`${ents.length} companies${DRY ? " · DRY RUN (no writes)" : ""}\n`);

let resolved = 0, feeds = 0, totalJobs = 0, withVendors = 0;
const platformTally: Record<string, number> = {};

for (const e of ents) {
  // 1. already known  2. left behind by earlier research  3. crawl the site
  let hit: { platform: string; a?: string; b?: string; url: string } | null = null;
  if (e.ats_platform && e.ats_url) {
    const id = identify(e.ats_url);
    if (id?.a) hit = { ...id, a: id.a, url: e.ats_url };
  }
  if (!hit) {
    const urls = (JSON.stringify([e.hiring_json, e.stack_json, e.profile_json, e.priorities_json]).match(/https?:\/\/[^"\\ ]+/g) ?? []);
    for (const u of urls) { const id = identify(u); if (id?.a) { hit = { ...id, a: id.a, url: u }; break; } }
  }
  if (!hit && e.website) hit = await discover(e.website);

  if (!hit) { console.log(`  ${String(e.ticker ?? "—").padEnd(6)}${String(e.canonical_name).slice(0, 28).padEnd(29)}no ATS found — keeps web search`); continue; }
  resolved++;
  platformTally[hit.platform] = (platformTally[hit.platform] ?? 0) + 1;

  const feed = await fetchFeed(hit.platform, hit.a!, hit.b);
  if (!feed) { console.log(`  ${String(e.ticker ?? "—").padEnd(6)}${String(e.canonical_name).slice(0, 28).padEnd(29)}${hit.platform} detected, no readable feed`); continue; }
  feeds++; totalJobs += feed.total;

  // Oracle's list has no description text, and that text is where the system
  // names are — so pull detail for the postings most likely to name one.
  let postings: Posting[] = feed.postings;
  if (hit.platform === "oracle" || hit.platform === "workday") {
    for (const p of postings.slice(0, 60)) {
      p.text = hit.platform === "oracle"
        ? await oracleDetail(hit.a!, hit.b!, (p as any)._id)
        : await workdayDetail(hit.a!, hit.b!, (p as any)._path);
      await sleep(90);
    }
  }

  const { vendors, relevant } = scanPostings(postings);
  if (vendors.size) withVendors++;

  const roles = relevant.slice(0, 8).map((p) => ({
    title: p.title,
    why: "Open role touching finance, ERP or capital-project systems — a live buying signal.",
    source: p.url,
  }));
  const signal = roles.length >= 3 ? "hot" : roles.length ? "warm" : "quiet";
  const vendorList = [...vendors.entries()].sort((a, b) => b[1].count - a[1].count);
  const hiring = {
    summary:
      `${feed.total} open role${feed.total === 1 ? "" : "s"} on ${e.canonical_name}'s own ${hit.platform} careers site` +
      (roles.length ? `, ${roles.length} touching finance or systems` : ", none obviously finance/systems related") +
      (vendorList.length ? `. Postings name: ${vendorList.map(([v, d]) => `${v} (${d.count})`).join(", ")}.` : "."),
    roles, signal,
    source: feed.url,
    via: "ats",
    vendors: vendorList.map(([v, d]) => ({ vendor: v, mentions: d.count, titles: d.titles })),
  };

  console.log(
    `  ${String(e.ticker ?? "—").padEnd(6)}${String(e.canonical_name).slice(0, 28).padEnd(29)}` +
    `${hit.platform.padEnd(11)}${String(feed.total).padStart(4)} jobs · ${String(roles.length).padStart(2)} relevant · ` +
    (vendorList.length ? vendorList.map(([v, d]) => `${v}×${d.count}`).join(" ") : "no vendors named")
  );

  if (!DRY && hasAtsCols) {
    await db.from("entities").update({
      hiring_json: hiring, hiring_at: new Date().toISOString(),
      ats_platform: hit.platform, ats_url: hit.url, ats_at: new Date().toISOString(),
    }).eq("id", e.id);
  }
  await sleep(200);
}

console.log(`\n=== ATS resolved ${resolved}/${ents.length} · readable feeds ${feeds} · ${totalJobs} open roles · ${withVendors} naming a vendor ===`);
for (const [k, v] of Object.entries(platformTally).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(2)}  ${k}`);
console.log(DRY ? "\n(dry run — nothing written)" : "");
