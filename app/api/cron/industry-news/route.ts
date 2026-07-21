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

export async function GET(request: Request) {
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "No API key" }, { status: 500 });

  const client = new Anthropic();
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
    return NextResponse.json({ found: items.length, inserted });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
