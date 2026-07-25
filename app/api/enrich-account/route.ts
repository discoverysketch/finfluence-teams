import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { fetchProxy } from "@/lib/proxy";
import { NextResponse } from "next/server";

// Deep public-data enrichment on the shared entity. Modes:
//  hiring — open finance/ERP/systems roles (buying-intent signal)
//  comp   — exec-compensation metrics from the DEF 14A proxy + employee count
//  fleet  — generation fleet summary (capacity, fuel mix, notable plants)
//  muni   — financial snapshot for non-SEC munis (from EMMA / official docs)
// Web-researched, structured, cached; whole team benefits from one run.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMAS: Record<string, any> = {
  hiring: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      roles: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, why: { type: "string" }, source: { type: "string" } }, required: ["title", "why", "source"] } },
      signal: { type: "string", enum: ["hot", "warm", "quiet"] },
    },
    required: ["summary", "roles", "signal"],
  },
  comp: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      metrics: { type: "array", items: { type: "object", additionalProperties: false, properties: { metric: { type: "string" }, detail: { type: "string" }, angle: { type: "string" } }, required: ["metric", "detail", "angle"] } },
      employees: { type: "integer" },
      source: { type: "string" },
    },
    required: ["summary", "metrics", "employees", "source"],
  },
  fleet: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      total_mw: { type: "number" },
      mix: { type: "array", items: { type: "object", additionalProperties: false, properties: { fuel: { type: "string" }, share_pct: { type: "number" } }, required: ["fuel", "share_pct"] } },
      notable: { type: "array", items: { type: "string" } },
      source: { type: "string" },
    },
    required: ["summary", "total_mw", "mix", "notable", "source"],
  },
  muni: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      revenue_musd: { type: "number" },
      debt_musd: { type: "number" },
      customers: { type: "integer" },
      rating: { type: "string" },
      source: { type: "string" },
    },
    required: ["summary", "revenue_musd", "debt_musd", "customers", "rating", "source"],
  },
};

const PROMPTS: Record<string, (name: string, st: string) => string> = {
  hiring: (name) =>
    `Research CURRENT open job postings at ${name} (a US utility) that signal an enterprise-software or finance-systems initiative. ` +
    `Search their careers page and job boards for roles like: Oracle/SAP/Workday ERP, financial systems analyst/manager, capital-project systems, EPM/planning, procurement systems, IT applications, digital transformation, controller/close roles. ` +
    `Budget: 2-3 searches + up to 2 fetches. List the relevant open roles with WHY each is a buying signal and the source URL. If nothing relevant is open, say so. signal = hot (multiple systems/ERP roles), warm (some finance-systems roles), quiet (nothing notable).`,
  comp: (name) =>
    `Research ${name}'s executive compensation METRICS from its most recent DEF 14A proxy statement (SEC filing). ` +
    `Search "${name} DEF 14A proxy statement executive compensation" and FETCH the proxy. Find the performance metrics that determine executive bonuses/incentive pay — utilities commonly tie pay to: O&M cost / cost per customer, return on equity (ROE), capital deployment/rate-base growth, EPS, safety, customer satisfaction, reliability. ` +
    `Also capture the company's total EMPLOYEE COUNT (from the 10-K or proxy). Budget: 2 searches + 2 fetches. For each metric: what it is, and the sales angle (how an ERP/EPM seller ties value to a metric leadership is literally paid to hit). Cite the proxy URL.`,
  fleet: (name) =>
    `Research ${name}'s electricity GENERATION FLEET (US utility). Search EIA data, their 10-K, or company pages. Capture: approximate total generating capacity (MW), the fuel mix (natural gas, coal, nuclear, hydro, wind, solar — approximate % shares), and 2-4 notable/large plants or recent additions/retirements. ` +
    `Budget: 2 searches + 1 fetch. If the utility is transmission/distribution-only with little generation, say so (total_mw 0). Cite a source URL.`,
  muni: (name) =>
    `Research the financial profile of ${name}, a US municipal/public utility with no SEC filings. Search MSRB EMMA (emma.msrb.org) for its bond official statements, plus its CAFR/annual financial report. Capture: annual operating revenue ($M), total outstanding debt/bonds ($M), customers served, and any public bond credit rating (Moody's/S&P/Fitch). ` +
    `Budget: 2-3 searches + up to 2 fetches. Use only figures you can cite. Cite the best source URL (prefer the EMMA official statement or the CAFR).`,
};

const COL: Record<string, [string, string]> = {
  hiring: ["hiring_json", "hiring_at"], comp: ["comp_json", "comp_at"], fleet: ["fleet_json", "fleet_at"], muni: ["muni_json", "muni_at"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, mode } = await request.json().catch(() => ({}));
  if (!entityId || !SCHEMAS[mode]) return NextResponse.json({ error: "Missing account or mode" }, { status: 400 });
  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state, cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    // COMP takes a deterministic path: DEF 14A is a standardized form, so it's
    // fetched straight from EDGAR and sliced to the incentive-metrics section.
    // Letting the model web-search for it gave inconsistent results (different
    // mirrors, different filing years per account) and cost ~$4.26 a lookup
    // against ~$0.11 here, because the whole proxy landed in context and was
    // re-billed on every turn of the tool loop.
    if (mode === "comp") {
      if (!ent.cik) return NextResponse.json({ error: "No SEC filings for this account — exec-comp metrics come from the DEF 14A proxy." }, { status: 422 });
      const proxy = await fetchProxy(ent.cik);
      if (!proxy) return NextResponse.json({ error: "Couldn't find a DEF 14A proxy on EDGAR for this account." }, { status: 502 });

      const res = await withRetry(() => client.messages.create({
        model: "claude-opus-4-8", max_tokens: 3000,
        output_config: { format: { type: "json_schema", schema: SCHEMAS.comp } } as any,
        system:
          "Extract the executive-compensation PERFORMANCE METRICS that determine incentive payout, from this proxy-statement excerpt. " +
          "Only metrics that actually drive bonus/incentive payout — never share counts, dividends, director fees or auditor fees. " +
          "For each: metric, detail (include the weighting when stated), and angle = how an Oracle ERP/EPM seller ties value to a number leadership is paid to hit. " +
          "employees = total employee count if the excerpt states it, else 0. summary = 2 sentences on how leadership is measured. " +
          "Use ONLY the excerpt — never invent a metric or figure.",
        messages: [{ role: "user", content: `Company: ${ent.canonical_name}\nProxy: ${proxy.url} (filed ${proxy.filed})\n\nExcerpt:\n${proxy.section}` }],
      }));
      const parsed = JSON.parse(res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join(""));
      parsed.source = proxy.url;      // always the canonical sec.gov document
      parsed.filed = proxy.filed;     // so the UI can say which proxy this is
      const admin = createAdminClient();
      const upd: Record<string, any> = { comp_json: parsed, comp_at: new Date().toISOString() };
      if (Number.isInteger(parsed.employees) && parsed.employees > 0) upd.employees = parsed.employees;
      await admin.from("entities").update(upd).eq("id", entityId);
      return NextResponse.json({ data: parsed });
    }

    const research = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 9000,
      tools: [
        // COST GUARD. An SEC proxy/10-K is enormous, and in an agentic loop the
        // fetched content is re-billed on every later turn — one uncapped comp
        // lookup measured 2.06M input tokens ($4.18). max_content_tokens
        // truncates each fetch; fewer uses means fewer turns to re-bill.
        { type: "web_search_20260209", name: "web_search", max_uses: 3 } as any,
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 24000 } as any,
      ],
      messages: [{ role: "user", content: PROMPTS[mode](ent.canonical_name, ent.hq_state || "") }],
    }));
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Research came back empty — try again." }, { status: 502 });

    const extract = await withRetry(() => client.messages.create({
      model: "claude-opus-4-8", max_tokens: 3000,
      output_config: { format: { type: "json_schema", schema: SCHEMAS[mode] } } as any,
      system: `Structure the ${mode} research from the notes. Use ONLY cited facts — never invent numbers, roles, or quotes. Include a source URL. Keep it tight and factual.`,
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nNotes:\n${notes.slice(0, 16000)}` }],
    }));
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const parsed = JSON.parse(text);

    const admin = createAdminClient();
    const [jsonCol, atCol] = COL[mode];
    const upd: Record<string, any> = { [jsonCol]: parsed, [atCol]: new Date().toISOString() };
    // Comp research also yields a real employee count — grounds the estimator.
    if (mode === "comp" && Number.isInteger(parsed.employees) && parsed.employees > 0) upd.employees = parsed.employees;
    await admin.from("entities").update(upd).eq("id", entityId);
    return NextResponse.json({ data: parsed });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
