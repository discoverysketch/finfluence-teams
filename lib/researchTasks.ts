// One definition per research task, shared by the in-app buttons and the batch
// sweep. If the batch used its own copy of these prompts, two accounts could be
// researched to different standards depending on how the research was kicked
// off — so the prompt, schema, tool budget and model all live here, once.
import type Anthropic from "@anthropic-ai/sdk";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type TaskKey = "hiring" | "comp" | "priorities" | "decision" | "stack" | "infer";
export type Ent = { id: string; canonical_name: string; ticker?: string | null; hq_state?: string | null; cik?: string | null };
export type TaskResult = { data: any; usage: { model: string; input: number; output: number; searches: number }[] };
// Injected by the caller so the Next route and the node seed script can each
// import lib/proxy the way their own module resolver expects.
export type FetchProxy = (cik: string) => Promise<{ url: string; filed: string; section: string } | null>;

const u = (model: string, usage: any) => ({
  model, input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0,
  searches: usage.server_tool_use?.web_search_requests ?? 0,
});
const textOf = (m: any) => m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

export const SCHEMAS: Record<TaskKey, any> = {
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
  priorities: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      priorities: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { theme: { type: "string" }, detail: { type: "string" }, quote: { type: "string" }, who: { type: "string" }, source: { type: "string" }, angle: { type: "string" } },
          required: ["theme", "detail", "quote", "who", "source", "angle"],
        },
      },
      as_of: { type: "string" },
    },
    required: ["summary", "priorities", "as_of"],
  },
  stack: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      incumbent: { type: "string" },
      systems: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            vendor: { type: "string" },
            product: { type: "string" },
            area: { type: "string", enum: ["ERP/Finance", "HCM", "Asset Management", "CIS/Billing", "Project Controls", "Procurement", "Other"] },
            evidence: { type: "string" },
            source: { type: "string" },
            confidence: { type: "string", enum: ["high", "medium", "low"] },
          },
          required: ["vendor", "product", "area", "evidence", "source", "confidence"],
        },
      },
      angles: {
        type: "array",
        items: { type: "object", additionalProperties: false, properties: { headline: { type: "string" }, detail: { type: "string" } }, required: ["headline", "detail"] },
      },
    },
    required: ["summary", "incumbent", "systems", "angles"],
  },
  // Pattern-level only. No names, no figures, no weightings, no source URLs —
  // an inferred specific is indistinguishable from a fabricated one.
  infer: {
    type: "object", additionalProperties: false,
    properties: {
      profile: { type: "string" },
      basis: { type: "array", items: { type: "string" } },
      areas: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            area: { type: "string", enum: ["Compensation & incentives", "Decision authority", "Priorities", "Buying process", "Financial posture"] },
            typical: { type: "string" },
            why: { type: "string" },
            confirm: { type: "string" },
          },
          required: ["area", "typical", "why", "confirm"],
        },
      },
      caution: { type: "string" },
    },
    required: ["profile", "basis", "areas", "caution"],
  },
  decision: {
    type: "object", additionalProperties: false,
    properties: {
      locus: { type: "string", enum: ["local", "corporate", "mixed"] },
      parent: { type: "string" },
      note: { type: "string" },
      source_url: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: ["locus", "parent", "note", "source_url", "confidence"],
  },
};

// Web-tool budgets are per task and deliberately tight: fetched content is
// re-billed on every later turn of the loop, so an uncapped fetch of a large
// filing is what turned a single lookup into millions of input tokens.
const TOOLS = (search: number, fetch: number, contentTokens = 30000) => [
  { type: "web_search_20260209", name: "web_search", max_uses: search } as any,
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: fetch, max_content_tokens: contentTokens } as any,
];

export async function runTask(client: Anthropic, ent: Ent, key: TaskKey, fetchProxy?: FetchProxy): Promise<TaskResult> {
  const usage: TaskResult["usage"] = [];

  // COMP is deterministic: DEF 14A is a standardized form, so it's pulled
  // straight from EDGAR and sliced. No web search, so every account is
  // researched from the same source in the same way.
  if (key === "comp") {
    if (!fetchProxy) throw new Error("comp requires the EDGAR proxy fetcher");
    if (!ent.cik) throw new Error("no CIK — exec-comp metrics come from the DEF 14A proxy");
    const proxy = await fetchProxy(ent.cik);
    if (!proxy) throw new Error("no DEF 14A found on EDGAR");
    const res = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 3000,
      output_config: { format: { type: "json_schema", schema: SCHEMAS.comp } } as any,
      system:
        "Extract the executive-compensation PERFORMANCE METRICS that determine incentive payout, from this proxy-statement excerpt. " +
        "Only metrics that actually drive bonus/incentive payout — never share counts, dividends, director fees or auditor fees. " +
        "For each: metric, detail (include the weighting when stated), and angle = how an Oracle ERP/EPM seller ties value to a number leadership is paid to hit. " +
        "employees = total employee count if the excerpt states it, else 0. summary = 2 sentences on how leadership is measured. " +
        "Use ONLY the excerpt — never invent a metric or figure.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}\nProxy: ${proxy.url} (filed ${proxy.filed})\n\nExcerpt:\n${proxy.section}` }],
    });
    usage.push(u("claude-opus-4-8", res.usage));
    const data = JSON.parse(textOf(res));
    data.source = proxy.url;
    data.filed = proxy.filed;
    return { data, usage };
  }

  const CFG: Record<Exclude<TaskKey, "comp">, { tools: any[]; maxTokens: number; prompt: string; extractModel: string; extractTokens: number; system: string; notesCap: number }> = {
    hiring: {
      tools: TOOLS(3, 2, 24000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3000, notesCap: 16000,
      prompt:
        `Research CURRENT open job postings at ${ent.canonical_name} (a US utility) that signal an enterprise-software or finance-systems initiative. ` +
        `Search their careers page and job boards for roles like: Oracle/SAP/Workday ERP, financial systems analyst/manager, capital-project systems, EPM/planning, procurement systems, IT applications, digital transformation, controller/close roles. ` +
        `Budget: 2-3 searches + up to 2 fetches. List the relevant open roles with WHY each is a buying signal and the source URL. If nothing relevant is open, say so. signal = hot (multiple systems/ERP roles), warm (some finance-systems roles), quiet (nothing notable).`,
      system: "Structure the hiring research from the notes. Use ONLY cited facts — never invent numbers, roles, or quotes. Include a source URL. Keep it tight and factual.",
    },
    priorities: {
      tools: TOOLS(3, 3), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3500, notesCap: 18000,
      prompt:
        `Research what leadership at ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""}${ent.hq_state ? `, a ${ent.hq_state} US utility` : ", a US utility"} is PUBLICLY PRIORITIZING right now. ` +
        `Sources, in order: (1) their MOST RECENT quarterly EARNINGS CALL — search "${ent.canonical_name} earnings call transcript" and read it for what the CEO/CFO emphasize (capital program, O&M / cost discipline, rate cases, technology/digital modernization, load growth, credit); ` +
        `(2) their latest 10-K management discussion (MD&A) and strategy; (3) any recent 8-K on a material strategic move. ` +
        `Budget: ~3 searches + 3 page fetches. For each priority theme capture: a short DIRECT QUOTE from an executive or filing, WHO said it, and the source URL. ` +
        `Focus on things an enterprise-software seller (finance, capital-project, cost, digital systems) could tie value to. Only report what you actually found with a citation.`,
      system:
        "Structure the leadership priorities from the notes. Use ONLY what's cited in the notes — never invent a quote or figure. " +
        "summary = 2 sentences on the strategic posture. Each priority: theme (3-6 words), detail (1-2 sentences), quote (a real direct quote from the notes — keep it short and verbatim), who (name + title if known), source (the URL), " +
        "angle (one line on how an Oracle ERP/EPM/Primavera seller ties value to this priority). as_of = the period/date of the newest source (e.g. 'Q2 2026 earnings call'). Drop any priority lacking a source URL.",
    },
    stack: {
      tools: TOOLS(3, 2, 24000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3000, notesCap: 16000,
      prompt:
        `Work out which ENTERPRISE SYSTEMS ${ent.canonical_name} (a US utility/energy company) appears to run TODAY, using PUBLIC evidence only. ` +
        `The strongest tells, in order: (1) their OWN JOB POSTINGS — search "${ent.canonical_name} jobs SAP", "${ent.canonical_name} jobs Workday", "${ent.canonical_name} Oracle analyst" — postings name the systems a team supports; ` +
        `(2) vendor PRESS RELEASES and CASE STUDIES naming them as a customer (SAP, Workday, IFS, Maximo/IBM, Infor, Itron, Itineris, Salesforce); ` +
        `(3) their 10-K or annual report technology/systems discussion; (4) conference talks or user-group presentations by their staff. ` +
        `Budget: ~3 searches + up to 2 fetches. Cover these areas where you find evidence: ERP/Finance, HCM, Asset Management (EAM), CIS/Billing, Project Controls, Procurement. ` +
        `For EACH system report the exact evidence and the source URL. This is a competitive assessment a salesperson will rely on, so accuracy matters more than completeness: ` +
        `if you cannot find real evidence for an area, OMIT it — never guess a vendor from what a utility "typically" runs.`,
      system:
        "Build a competitive picture of the systems this company runs, from the notes ONLY. " +
        "systems = one entry per system you found real evidence for; evidence = the specific public tell (quote the job-posting phrase or press-release line); source = the URL; " +
        "confidence: high = named in a vendor case study or their own filing, medium = named in their own job posting, low = indirect/inferred. " +
        "incumbent = the primary ERP/finance vendor if the evidence supports one, else 'unclear'. " +
        "angles = 2-4 honest displacement angles for an Oracle ERP/EPM/Primavera seller, each grounded in something specific in the notes (an ageing release, a fragmented estate, a system nearing end of support, a manual integration). " +
        "Never invent a system, a customer relationship, or a weakness. If the evidence is thin, say so in summary and return fewer systems.",
    },
    infer: {
      tools: TOOLS(2, 1, 20000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3000, notesCap: 14000,
      prompt:
        `${ent.canonical_name} files nothing public (no SEC filings), so the usual sources are empty. ` +
        `FIRST establish only what is publicly knowable about WHAT KIND of company it is: ownership (private equity / infrastructure fund / utility subsidiary / municipal / co-operative), ` +
        `rough scale, business model (developer, IPP, regulated utility, water authority), and whether it operates through project SPVs, joint ventures or tax-equity partnerships. ` +
        `Budget: 2 searches + 1 fetch — company site, press releases, trade press. ` +
        `THEN, from that profile alone, describe what is TYPICAL for companies of that type in: how leadership is compensated and on what measures; where enterprise-software decisions get made; what leadership typically prioritises; how they typically buy; and their typical financial posture. ` +
        `You are reasoning from company TYPE, not reporting facts about this company. Do NOT state or estimate any specific figure, weighting, percentage, executive name, or system for THIS company — only the pattern for its category, and what would confirm it.`,
      system:
        "Produce a PATTERN-level read for a company with no public filings. This is explicitly an inference, and a salesperson will act on it, so the line between pattern and fact must be absolute. " +
        "profile = one sentence naming the company TYPE (e.g. a private renewables developer operating through project SPVs with tax-equity partners). " +
        "basis = the publicly-observed facts about the company that put it in that category (ownership, model, structure) — only things actually found. " +
        "areas = for each: typical (what companies of this type usually do — phrase it as 'typically' or 'at this profile', never as a claim about them), " +
        "why (what about THIS company puts it in that pattern), confirm (the question a rep should ask to verify it in the meeting). " +
        "caution = the main way this inference could be wrong for this particular company. " +
        "NEVER invent: an executive name, a dollar figure, a percentage or weighting, a metric name attributed to them, a system they run, or a source URL. " +
        "If you cannot place the company confidently, say so in profile and return fewer areas.",
    },
    decision: {
      tools: TOOLS(2, 2), maxTokens: 9000, extractModel: "claude-sonnet-5", extractTokens: 2000, notesCap: 14000,
      prompt:
        `Research where enterprise-software and major procurement DECISIONS are made for ${ent.canonical_name}${ent.hq_state ? ` (${ent.hq_state})` : ""}, a US utility/energy company. ` +
        `Key question: does it operate autonomously (own CFO/CIO sign for major systems), or does a corporate parent centralize IT/procurement/shared services? ` +
        `Evidence to look for: whether it is a subsidiary and of whom; centralized shared-services or procurement organizations at the parent; a single ERP/IT organization across the family; where the CIO/CFO for the family sit. ` +
        `Budget: up to 2 searches + 2 page fetches. Report what you found with the URL of the best source. If evidence is thin, say so.`,
      system:
        "From the research notes, decide the decision locus for major software purchases at this company: " +
        "'local' (it signs for itself), 'corporate' (a parent decides — name it in `parent`), or 'mixed' (depends / shared). " +
        "parent = the deciding parent's name, or '' if local. note = 1-2 plain sentences a rep can act on. " +
        "source_url = the best URL from the notes ('' if none). confidence reflects the evidence.",
    },
  };

  const cfg = CFG[key as Exclude<TaskKey, "comp">];
  const research = await client.messages.create({
    model: "claude-sonnet-5", max_tokens: cfg.maxTokens, tools: cfg.tools,
    messages: [{ role: "user", content: cfg.prompt }],
  });
  usage.push(u("claude-sonnet-5", research.usage));
  const notes = textOf(research);
  if (!notes) throw new Error("research came back empty");

  const extract = await client.messages.create({
    model: cfg.extractModel, max_tokens: cfg.extractTokens,
    output_config: { format: { type: "json_schema", schema: SCHEMAS[key] } } as any,
    system: cfg.system,
    messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nResearch notes:\n${notes.slice(0, cfg.notesCap)}` }],
  });
  usage.push(u(cfg.extractModel, extract.usage));
  const parsed = JSON.parse(textOf(extract));

  // The battlecard often finds the same system in two places (a vendor case
  // study and a conference talk). Two identical rows read as sloppy, so merge
  // them and keep the strongest evidence — extra corroboration is a reason to
  // trust it more, not to print it twice.
  if (key === "stack" && Array.isArray(parsed.systems)) {
    const RANK = { high: 3, medium: 2, low: 1 } as Record<string, number>;
    const merged = new Map<string, any>();
    for (const sy of parsed.systems) {
      const id = `${String(sy.vendor).toLowerCase().trim()}|${String(sy.area).toLowerCase().trim()}`;
      const prev = merged.get(id);
      if (!prev) { merged.set(id, sy); continue; }
      if ((RANK[sy.confidence] ?? 0) > (RANK[prev.confidence] ?? 0)) merged.set(id, { ...sy, corroborated: true });
      else merged.set(id, { ...prev, corroborated: true });
    }
    parsed.systems = [...merged.values()];
  }
  return { data: parsed, usage };
}

// Per-1M pricing, for the batch runner's live spend counter.
export const PRICE: Record<string, { in: number; out: number }> = {
  "claude-sonnet-5": { in: 2.0, out: 10.0 },   // intro pricing through 2026-08-31
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
};
export const WEB_SEARCH_COST = 0.01; // $10 per 1,000 searches
export const costOf = (rows: TaskResult["usage"]) =>
  rows.reduce((sum, r) => sum + (r.input * (PRICE[r.model]?.in ?? 0) + r.output * (PRICE[r.model]?.out ?? 0)) / 1e6 + r.searches * WEB_SEARCH_COST, 0);
