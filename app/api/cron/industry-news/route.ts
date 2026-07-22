import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Daily industry-news sweep (SPEC 7c buying-signal feed, industry-wide layer):
// one web-search batch per day gathering utility/power-sector news — capital
// projects, data-center load growth, regulatory (FERC/EEI/PUC), rates, M&A.
// Cost-controlled: a single research call; results dedupe on source_url.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */
const NEWS_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          headline: { type: "string" },
          summary: { type: "string" },
          category: { type: "string", enum: ["capital_projects", "data_centers", "regulatory", "rates", "ma", "grid", "competitor", "other"] },
          source_url: { type: "string" },
          published: { type: "string" },
          companies: { type: "string" },
        },
        required: ["headline", "summary", "category", "source_url", "published", "companies"],
      },
    },
  },
  required: ["items"],
};

// ---- Per-account news harvest (Google News RSS: free, every outlet) ----
// One RSS fetch per book entity, then ONE model call to filter out stock-tip
// spam and keep sales-relevant items (projects, rate cases, leadership,
// regulatory). Kept items are tagged with the account name so they surface in
// that account's Hub, the feed's ★ badge, and outreach drafting.
const RSS_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    items: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          idx: { type: "integer" },
          keep: { type: "boolean" },
          category: { type: "string", enum: ["capital_projects", "data_centers", "regulatory", "rates", "ma", "grid", "competitor", "other"] },
          summary: { type: "string" },
        },
        required: ["idx", "keep", "category", "summary"],
      },
    },
  },
  required: ["items"],
};

async function harvestAccountNews(client: Anthropic, admin: ReturnType<typeof createAdminClient>) {
  const { data: accts } = await admin.from("accounts").select("entity:entities(id, canonical_name)").not("entity_id", "is", null);
  const ents = [...new Map(((accts ?? []) as any[]).filter((a) => a.entity).map((a) => [a.entity.id, a.entity])).values()].slice(0, 60);
  if (!ents.length) return { scanned: 0, kept: 0 };

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const cand: { account: string; title: string; link: string; source: string; published: string }[] = [];
  for (const e of ents) {
    try {
      const r = await fetch(`https://news.google.com/rss/search?q=${encodeURIComponent(`"${e.canonical_name}"`)}&hl=en-US&gl=US&ceid=US:en`, { signal: AbortSignal.timeout(6000) });
      if (!r.ok) continue;
      const xml = await r.text();
      const items = xml.split("<item>").slice(1);
      let taken = 0;
      for (const it of items) {
        if (taken >= 3) break;
        const title = (it.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "").trim();
        const link = (it.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? "").trim();
        const pub = (it.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "").trim();
        const source = (it.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? "").trim();
        if (!title || !link || !pub || +new Date(pub) < weekAgo) continue;
        cand.push({ account: e.canonical_name, title: title.replace(/ - [^-]+$/, ""), link, source, published: new Date(pub).toISOString().slice(0, 10) });
        taken++;
      }
    } catch { /* next entity */ }
  }
  if (!cand.length) return { scanned: ents.length, kept: 0 };

  // Skip anything already in the feed (Google links are stable per article).
  const { data: existing } = await admin.from("news_items").select("source_url").order("created_at", { ascending: false }).limit(600);
  const seen = new Set(((existing ?? []) as any[]).map((x) => x.source_url));
  const fresh = cand.filter((c) => !seen.has(c.link)).slice(0, 60);
  if (!fresh.length) return { scanned: ents.length, kept: 0 };

  const listing = fresh.map((c, i) => `${i}. [${c.account}] ${c.title} (${c.source}, ${c.published})`).join("\n");
  const res = await client.messages.create({
    model: "claude-sonnet-5", max_tokens: 6000,
    output_config: { format: { type: "json_schema", schema: RSS_SCHEMA } } as any,
    system:
      "These are news headlines about a utility sales team's named accounts. For each index, keep=true ONLY for sales-relevant company news: " +
      "capital projects/investments, rate cases & regulatory actions, leadership changes, earnings/financings, M&A, data-center/load deals, major outages/operations, enterprise-software/vendor news. " +
      "keep=false for: stock-picking/analyst-opinion spam ('3 reasons to buy...', price targets), dividend-declaration boilerplate, generic market roundups, anything where the account is only incidentally mentioned. " +
      "category: best fit. summary: one factual sentence from the headline (<=25 words, no speculation beyond it).",
    messages: [{ role: "user", content: listing }],
  });
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
  const verdicts = (JSON.parse(text).items ?? []) as { idx: number; keep: boolean; category: string; summary: string }[];

  let kept = 0;
  for (const v of verdicts) {
    const c = fresh[v.idx];
    if (!c || !v.keep) continue;
    const { error } = await admin.from("news_items").insert({
      headline: c.title.slice(0, 300), summary: String(v.summary || "").slice(0, 600), category: v.category,
      source_url: c.link, published: c.published, companies: c.account.slice(0, 400),
    });
    if (!error) kept++;
  }
  return { scanned: ents.length, kept };
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const client = new Anthropic();
  // Account-level harvest first — fast and bounded, so the slower web sweep
  // can never starve it of the 300s budget.
  let accountNews: { scanned: number; kept: number } | null = null;
  try { accountNews = await harvestAccountNews(client, createAdminClient()); } catch (e) { accountNews = { scanned: -1, kept: 0 }; console.error("harvest:", (e as Error).message); }
  try {
    // 1) One efficient research pass. HARD search cap: a single broad query's
    //    result list already names many stories with URLs; more searches risk
    //    blowing the 300s function ceiling (observed: sweeps can run 5+ min).
    const research = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 9000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 } as any],
      messages: [{
        role: "user",
        content:
          `Today is ${new Date().toISOString().slice(0, 10)}. Find 6-8 significant US utility & power industry news items published within the LAST 14 DAYS — skip anything older or undated unless it is clearly this week's news. Cover a MIX of: ` +
          "new capital projects / grid investments; data-center load-growth deals with utilities; regulatory & policy developments (FERC, EEI, state PUCs); utility M&A or large financings; and RATE CASES. " +
          "STRICT search budget of THREE queries: (1) ONE broad query (e.g. 'utility industry news capital projects data centers FERC') for general items; (2) ONE query dedicated to rate cases (e.g. 'utility rate case filing PUC this month') — the highest-value buying signal; (3) ONE query for enterprise-software competitor activity at utilities (e.g. 'utility SAP OR Workday ERP implementation selects') — competitor wins/selections at utilities are incumbent intelligence. Do not run more searches. " +
          "For each item: tight headline, 1-2 sentence factual summary, companies involved, approximate publish date, EXACT source URL from your results. " +
          "Only include items citable with a URL from your results.",
      }],
    });
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "empty research" }, { status: 502 });

    // 2) Structure (Sonnet — extraction is easy; speed matters inside the 300s cap).
    const extract = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: NEWS_SCHEMA } } as any,
      system:
        "Turn the research notes into structured news items. ONLY items with a real source URL in the notes — drop the rest. " +
        "category: capital_projects | data_centers | regulatory (FERC/EEI/policy) | rates (rate cases) | ma | grid (reliability/operations) | competitor (enterprise-software vendor news at utilities: SAP, Workday, Microsoft, Infor, IFS selections/implementations) | other. " +
        "companies = comma-separated company/organization names mentioned (use common names, e.g. 'Duke Energy, Amazon'). published = YYYY-MM-DD if known else ''.",
      messages: [{ role: "user", content: `Research notes:\n\n${notes.slice(0, 20000)}` }],
    });
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    // Freshness gate: search results love resurfacing evergreen old articles —
    // drop anything with a publish date older than 21 days at the door.
    const cutoff = new Date(Date.now() - 21 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const items = (JSON.parse(text).items ?? []).filter((i: any) =>
      /^https?:\/\//.test(i.source_url) &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(i.published) || i.published >= cutoff));

    const admin = createAdminClient();
    let inserted = 0;
    for (const i of items) {
      const { error } = await admin.from("news_items").insert({
        headline: i.headline.slice(0, 300), summary: i.summary.slice(0, 600), category: i.category,
        source_url: i.source_url, published: /^\d{4}-\d{2}-\d{2}$/.test(i.published) ? i.published : null,
        companies: i.companies?.slice(0, 400) || null,
      });
      if (!error) inserted++; // unique(source_url) silently skips repeats
    }
    return NextResponse.json({ found: items.length, inserted, accountNews });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: msg, accountNews }, { status: 502 });
  }
}
