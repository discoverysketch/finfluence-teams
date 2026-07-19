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
          category: { type: "string", enum: ["capital_projects", "data_centers", "regulatory", "rates", "ma", "grid", "other"] },
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
    // 1) One efficient research pass (Sonnet — fast with web search).
    const research = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 3000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 } as any],
      messages: [{
        role: "user",
        content:
          "Find the 8-10 most significant US utility & power industry news items from roughly the last 3 days. Cover a MIX of: " +
          "new capital projects / grid investments announced by utilities; data-center load-growth deals and interconnection agreements with utilities; " +
          "regulatory & policy developments (FERC orders, EEI positions, notable state PUC decisions, major rate cases); and utility M&A or large financings. " +
          "Be efficient with searches — broad queries first (e.g. utility industry news capital projects data centers), then follow up only if needed. " +
          "For each item: a tight headline, a 1-2 sentence factual summary, the companies/organizations involved, approximate publish date, and the EXACT source URL from your results. " +
          "Only include items you can cite with a URL. Skip paywalled-summary spam; prefer trade press (Utility Dive, E&E, S&P Global), official releases, and major outlets.",
      }],
    });
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "empty research" }, { status: 502 });

    // 2) Structure.
    const extract = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: NEWS_SCHEMA } } as any,
      system:
        "Turn the research notes into structured news items. ONLY items with a real source URL in the notes — drop the rest. " +
        "category: capital_projects | data_centers | regulatory (FERC/EEI/policy) | rates (rate cases) | ma | grid (reliability/operations) | other. " +
        "companies = comma-separated company/organization names mentioned (use common names, e.g. 'Duke Energy, Amazon'). published = YYYY-MM-DD if known else ''.",
      messages: [{ role: "user", content: `Research notes:\n\n${notes.slice(0, 20000)}` }],
    });
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const items = (JSON.parse(text).items ?? []).filter((i: any) => /^https?:\/\//.test(i.source_url));

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
