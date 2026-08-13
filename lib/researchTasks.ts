// One definition per research task, shared by the in-app buttons and the batch
// sweep. If the batch used its own copy of these prompts, two accounts could be
// researched to different standards depending on how the research was kicked
// off — so the prompt, schema, tool budget and model all live here, once.
import type Anthropic from "@anthropic-ai/sdk";
import { inferArchetype, descriptor, sourcePlan, peoplePlan, type Archetype } from "./archetype";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type TaskKey = "hiring" | "comp" | "priorities" | "decision" | "stack" | "infer" | "risks" | "dockets" | "business";
export type Ent = { id: string; canonical_name: string; ticker?: string | null; hq_state?: string | null; cik?: string | null; sic?: string | null; entity_type?: string | null; parent_name?: string | null };
export type TaskResult = { data: any; usage: { model: string; input: number; output: number; searches: number }[] };
// Injected by the caller so the Next route and the node seed script can each
// import lib/proxy the way their own module resolver expects.
export type FetchProxy = (cik: string) => Promise<{ url: string; filed: string; section: string } | null>;
// Injected like the fetchers above: the Next route resolves "@/lib/dockets"
// and the node seed script needs "../lib/dockets.ts", and neither spelling
// satisfies both resolvers. The caller imports it and passes the result.
export type Commission = { name: string; abbr: string; domain: string };
export type FetchRisks = (cik: string) => Promise<{ url: string; filed: string; section: string } | null>;
export type FetchLeadership = (cik: string) => Promise<{
  earnings: { url: string; filed: string; text: string } | null;
  mdna: { url: string; filed: string; text: string } | null;
}>;

// Every research call aborts at 210s. The serverless function dies at 300s,
// and a request that reaches that point returns an opaque gateway error after
// the user has already waited five minutes. Failing earlier, with a message,
// is strictly better. Priorities used to run 914s and could never succeed.
const DEADLINE_MS = 210_000;
const NO_BATCH =
  "Run ONE search at a time and read each result before the next — do NOT batch several queries into a single code block. " +
  "Batching burns the whole search allowance in one burst and returns nothing. Stop as soon as you have what you need.";

const u = (model: string, usage: any) => ({
  model, input: usage.input_tokens ?? 0, output: usage.output_tokens ?? 0,
  searches: usage.server_tool_use?.web_search_requests ?? 0,
});
const textOf = (m: any) => m.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();

export const SCHEMAS: Record<TaskKey, any> = {
  business: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      what_they_do: { type: "string" },
      scale: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { label: { type: "string" }, value: { type: "string" }, source: { type: "string" } },
          required: ["label", "value", "source"],
        },
      },
      developments: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            headline: { type: "string" }, detail: { type: "string" }, date: { type: "string" },
            angle: { type: "string" }, source: { type: "string" },
          },
          required: ["headline", "detail", "date", "angle", "source"],
        },
      },
      systems: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: { name: { type: "string" }, evidence: { type: "string" }, source: { type: "string" } },
          required: ["name", "evidence", "source"],
        },
      },
      how_they_decide: { type: "string" },
      as_of: { type: "string" },
    },
    required: ["summary", "what_they_do", "scale", "developments", "systems", "how_they_decide", "as_of"],
  },
  dockets: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      cases: {
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            docket: { type: "string" },       // e.g. "ER-2026-0044"
            commission: { type: "string" },   // e.g. "Missouri PSC"
            title: { type: "string" },
            filed: { type: "string" },
            status: { type: "string" },
            ask: { type: "string" },          // requested revenue increase, verbatim if stated
            drivers: { type: "string" },      // what they say the money is for
            systems: { type: "array", items: { type: "string" } }, // named software/systems, [] if none
            angle: { type: "string" },
            source: { type: "string" },
          },
          required: ["docket", "commission", "title", "filed", "status", "ask", "drivers", "systems", "angle", "source"],
        },
      },
      as_of: { type: "string" },
    },
    required: ["summary", "cases", "as_of"],
  },
  risks: {
    type: "object", additionalProperties: false,
    properties: {
      summary: { type: "string" },
      risks: {
        // No maxItems — the API rejects it on output schemas. The prompt asks
        // for at most 8 and the route slices defensively.
        type: "array",
        items: {
          type: "object", additionalProperties: false,
          properties: {
            theme: { type: "string" },
            detail: { type: "string" },
            quote: { type: "string" },
            // What kind of exposure it is, so the UI can rank the ones a
            // software seller can actually do something about.
            exposure: { type: "string", enum: ["technology", "execution", "control", "workforce", "other"] },
            angle: { type: "string" },
            source: { type: "string" },
          },
          required: ["theme", "detail", "quote", "exposure", "angle", "source"],
        },
      },
      as_of: { type: "string" },
    },
    required: ["summary", "risks", "as_of"],
  },
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

export async function runTask(client: Anthropic, ent: Ent, key: TaskKey, fetchProxy?: FetchProxy, fetchLeadership?: FetchLeadership, atsVendors?: { vendor: string; mentions: number; titles: string[] }[], fetchRisks?: FetchRisks, comms: Commission[] = []): Promise<TaskResult> {
  const usage: TaskResult["usage"] = [];
  const NL = String.fromCharCode(10);
  const SEP = NL + NL + "---" + NL + NL;

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
    }, { timeout: DEADLINE_MS });
    usage.push(u("claude-opus-4-8", res.usage));
    const data = JSON.parse(textOf(res));
    data.source = proxy.url;
    data.filed = proxy.filed;
    return { data, usage };
  }

  // RISKS is deterministic — Item 1A of the 10-K is a fixed, addressable
  // section, so there is nothing to search for. It is also the most candid
  // page a company publishes: legal exposure forces them to name aging
  // systems, integration failures, control weaknesses and cyber gaps that
  // never appear in the investor deck. No web search, one extraction call.
  if (key === "risks") {
    if (!fetchRisks || !ent.cik) {
      throw new Error("Risk factors come from 10-K Item 1A, so this needs an SEC filer. This account has no CIK on file.");
    }
    const doc = await fetchRisks(ent.cik);
    if (!doc) throw new Error("No 10-K Item 1A section found for this filer.");
    const res = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 3500,
      output_config: { format: { type: "json_schema", schema: SCHEMAS.risks } } as any,
      system:
        "Extract the risk factors that an enterprise-software seller (Oracle ERP / EPM / Primavera) could act on, from this 10-K Item 1A text ONLY. " +
        "Most risk factors are boilerplate — weather, commodity prices, interest rates, litigation. SKIP those. Keep only risks touching: information technology and cyber, " +
        "aging or legacy systems, ERP/system implementations, data and integration, internal control over financial reporting or material weaknesses, capital-project execution and cost overruns, " +
        "supply chain, and workforce/talent retention. " +
        "summary = 2 sentences on where this company says it is exposed. Each risk: theme (3-6 words), detail (1-2 sentences in plain language), " +
        "quote (a REAL verbatim fragment from the text, under 30 words — never invent one), exposure (technology | execution | control | workforce | other), " +
        "angle (one line on how an Oracle seller ties a capability to this exposure — be specific and non-glib; if there is no honest angle, say so plainly), " +
        "source (use the filing URL given above the text). as_of = the fiscal year of the filing. " +
        "If fewer than 8 qualify, return only those that do. Never invent a quote, figure or system name.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}` + SEP + `10-K ITEM 1A RISK FACTORS (filed ${doc.filed})` + NL + doc.url + NL + doc.section }],
    }, { timeout: DEADLINE_MS });
    usage.push(u("claude-opus-4-8", res.usage));
    return { data: JSON.parse(textOf(res)), usage };
  }

  // PRIORITIES is deterministic too. What leadership is saying lives in known
  // places: the CEO/CFO quotes are in the 8-K earnings release (Item 2.02) and
  // the strategy is in 10-K Item 7 MD&A. Searching the open web for it took
  // 914s and never completed inside the function limit; fetching the two known
  // documents takes seconds and returns the same quotes every time.
  if (key === "priorities" && fetchLeadership && ent.cik) {
    const docs = await fetchLeadership(ent.cik);
    const parts: string[] = [];
    if (docs.earnings) parts.push(`EARNINGS RELEASE (8-K Item 2.02, filed ${docs.earnings.filed})` + NL + docs.earnings.url + NL + docs.earnings.text);
    if (docs.mdna) parts.push(`10-K ITEM 7 MD&A (filed ${docs.mdna.filed})` + NL + docs.mdna.url + NL + docs.mdna.text);
    if (parts.length) {
      const res = await client.messages.create({
        model: "claude-opus-4-8", max_tokens: 3500,
        output_config: { format: { type: "json_schema", schema: SCHEMAS.priorities } } as any,
        system:
          "Extract what LEADERSHIP is publicly prioritising, from these filings ONLY. The earnings release carries direct CEO/CFO quotes; the MD&A carries strategy, capital plans and outlook. " +
          "summary = 2 sentences on the strategic posture. Each priority: theme (3-6 words), detail (1-2 sentences), quote (a REAL verbatim quote from the text — prefer the executive quotes in the earnings release; empty string if none), " +
          "who (name + title if stated), source (use the filing URL given above the text it came from), " +
          "angle (one line on how an Oracle ERP/EPM/Primavera seller ties value to it). as_of = the period the newest document covers. " +
          "Focus on things an enterprise-software seller could tie value to: capital programme, O&M and cost discipline, rate cases, digital/technology modernisation, load growth, credit. Never invent a quote or figure.",
        messages: [{ role: "user", content: `Company: ${ent.canonical_name}` + SEP + parts.join(SEP) }],
      }, { timeout: DEADLINE_MS });
      usage.push(u("claude-opus-4-8", res.usage));
      return { data: JSON.parse(textOf(res)), usage };
    }
    // No filings found (non-filer) — fall through to the web-search path below.
  }

  // Rate case dockets. A utility justifies its spending under oath here, so
  // testimony is the one public place that names the systems being replaced,
  // what they cost and when. There is no national index of dockets and every
  // state runs its own filing system, so instead of integrating forty of them
  // we name the right commission and its domain and let the search be scoped.
  // How this company is described, and where its information actually lives.
  // Everything below used to assume a US utility, which is why a private
  // subsidiary or a listed retailer came back thin: the searches were aimed at
  // filings and commissions that do not exist for them.
  const arch: Archetype = inferArchetype(ent);
  const WHO = descriptor(ent, arch);
  const WHERE = sourcePlan(arch, ent);
  const WHO_PEOPLE = peoplePlan(arch, ent);

  const CFG: Record<Exclude<TaskKey, "comp" | "stack" | "risks">, { tools: any[]; maxTokens: number; prompt: string; extractModel: string; extractTokens: number; system: string; notesCap: number }> = {
    dockets: {
      tools: TOOLS(4, 1, 16000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 4000, notesCap: 18000,
      prompt:
        `Find the MOST RECENT general RATE CASE filed by ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""} or its regulated operating subsidiaries, and what the company said the money is for.

` +
        (comms.length
          ? `They file with: ${comms.map((c) => `${c.name} (${c.abbr}) — filing system at ${c.domain}`).join("; ")}. Search those commissions FIRST, using site: on those domains and the commission name. `
          : `Identify which state utility commission regulates them, then search that commission's filing system. `) +
        `Note the OPERATING company usually files, not the holding company (Ameren Missouri and Union Electric, not Ameren Corp; Ohio Power and AEP Ohio, not AEP).

` +
        `For each rate case found (at most 3, newest first) capture: the DOCKET NUMBER exactly as the commission writes it, the commission, the case title, when it was filed, its status, the requested revenue increase, ` +
        `and what the company says is DRIVING the request — capital programme, grid modernisation, technology and IT investment, O&M.

` +
        `Then look specifically for NAMED SYSTEMS in the filing or testimony: customer information system (CIS), enterprise resource planning (ERP), work and asset management, meter data management, general ledger, budgeting and forecasting, ` +
        `and named vendors (Oracle, SAP, Workday, IBM Maximo, Salesforce, Itron). Utilities name these when justifying capital or deferred accounting for a software project. Only list a system if it is ACTUALLY NAMED in a source you read — an empty list is the correct answer when none is named.

` +
        `${NO_BATCH} Budget: 4 searches + at most 1 page fetch. Prefer the commission's own docket page and the company's filed testimony over news coverage. Every case needs a source URL.`,
      system:
        "Structure the rate case findings from the notes. Use ONLY what is cited — never invent a docket number, figure or system name; a wrong docket number is worse than none. " +
        "docket = exactly as the commission writes it (e.g. ER-2026-0044, 24-E-0319, A.25-05-012). ask = the requested revenue increase as stated, empty string if not found. " +
        "drivers = 1-2 sentences on what the company says the money is for. systems = ONLY software or systems actually named in a source; empty array otherwise — do not infer from 'technology investment'. " +
        "angle = one line on how an Oracle ERP/EPM/Primavera seller uses this (a live rate case means capital is being justified and scrutinised; be specific and honest, and say so if the tie is weak). " +
        "as_of = the date of the newest case found. Drop any case without a source URL.",
    },
    business: {
      tools: TOOLS(5, 2, 22000), maxTokens: 11000, extractModel: "claude-opus-4-8", extractTokens: 3800, notesCap: 22000,
      prompt:
        `Build a picture of the BUSINESS at ${WHO} for a seller of enterprise finance and operations software. ` +
        `This company may publish very little, so do not give up when the usual sources are empty — go where companies like this ARE covered. ` +
        WHERE + " " + NO_BATCH + " Budget: 5 searches + at most 2 page fetches. " +
        `Capture: what they actually do and how they make money; their scale (revenue, headcount, sites, stores, plants, customers) with a source for each figure — an approximate figure with a citation beats a precise one you invented; ` +
        `recent developments in the last 18 months that create work for a finance or operations system — expansions, new facilities, acquisitions, leadership changes, systems projects, restructuring; ` +
        `any SYSTEM they are visibly running, from job postings, press or their own site; and how a company of this ownership structure actually decides on enterprise software. ` +
        `Only report what you found with a citation. If a figure is an estimate published by someone else, say whose.`,
      system:
        "Structure a business picture from the notes. Use ONLY cited facts — never invent a revenue figure, headcount, date or system. " +
        "summary = 2 sentences a rep could open a meeting with. what_they_do = one plain sentence on the business model. " +
        "scale = the size figures actually found, each with its source URL; omit rather than guess. " +
        "developments = recent events that create work for finance or operations systems, newest first; angle = one line on why it matters to an Oracle ERP/EPM/SCM seller. " +
        "systems = any named software with the evidence for it and a source. " +
        "how_they_decide = where enterprise-software decisions realistically sit given the ownership structure, and what would confirm it. " +
        "as_of = the date of the newest source. Drop anything lacking a source URL.",
    },
    hiring: {
      tools: TOOLS(3, 1, 18000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3000, notesCap: 16000,
      prompt:
        `Research CURRENT open job postings at ${WHO} that signal an enterprise-software or finance-systems initiative. ` + WHERE + " " +
        `Search their careers page and job boards for roles like: Oracle/SAP/Workday ERP, financial systems analyst/manager, capital-project systems, EPM/planning, procurement systems, IT applications, digital transformation, controller/close roles. Also look specifically for PowerPlan, fixed-asset accounting, capital-project (CWIP) accounting, tax fixed assets, lease accounting and regulatory/FERC accounting roles — at a regulated utility these name the asset-accounting platform, and PowerPlan is an Oracle PARTNER that runs alongside Oracle ERP, so finding it is a co-sell signal rather than a competitive one. ` +
        `${NO_BATCH} Budget: 3 searches + at most 1 fetch. List the relevant open roles with WHY each is a buying signal and the source URL. If nothing relevant is open, say so. signal = hot (multiple systems/ERP roles), warm (some finance-systems roles), quiet (nothing notable).`,
      system: "Structure the hiring research from the notes. Use ONLY cited facts — never invent numbers, roles, or quotes. Include a source URL. Keep it tight and factual.",
    },
    priorities: {
      tools: TOOLS(4, 1, 18000), maxTokens: 9000, extractModel: "claude-opus-4-8", extractTokens: 3500, notesCap: 18000,
      prompt:
        `Research what leadership at ${WHO} is PUBLICLY PRIORITIZING right now. ` + WHERE + " " +
        `Where the company files with the SEC, read the most recent earnings call and the 10-K MD&A first. ` +
        `${NO_BATCH} Budget: 4 searches + at most 1 page fetch — prefer quotes visible in search results over fetching whole transcripts, which is what made this time out. For each priority theme capture: a short DIRECT QUOTE from an executive or filing, WHO said it, and the source URL. ` +
        `Focus on things an enterprise-software seller (finance, capital-project, cost, digital systems) could tie value to. Only report what you actually found with a citation.`,
      system:
        "Structure the leadership priorities from the notes. Use ONLY what's cited in the notes — never invent a quote or figure. " +
        "summary = 2 sentences on the strategic posture. Each priority: theme (3-6 words), detail (1-2 sentences), quote (a real direct quote from the notes — keep it short and verbatim), who (name + title if known), source (the URL), " +
        "angle (one line on how an Oracle ERP/EPM/Primavera seller ties value to this priority). as_of = the period/date of the newest source (e.g. 'Q2 2026 earnings call'). Drop any priority lacking a source URL.",
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
      tools: TOOLS(3, 1, 18000), maxTokens: 9000, extractModel: "claude-sonnet-5", extractTokens: 2000, notesCap: 14000,
      prompt:
        `Research where enterprise-software and major procurement DECISIONS are made for ${ent.canonical_name}${ent.hq_state ? ` (${ent.hq_state})` : ""}, a US utility/energy company. ` +
        `Key question: does it operate autonomously (own CFO/CIO sign for major systems), or does a corporate parent centralize IT/procurement/shared services? ` +
        `Evidence to look for: whether it is a subsidiary and of whom; centralized shared-services or procurement organizations at the parent; a single ERP/IT organization across the family; where the CIO/CFO for the family sit. ` +
        `${NO_BATCH} Budget: up to 3 searches + 1 page fetch. Report what you found with the URL of the best source. If evidence is thin, say so.`,
      system:
        "From the research notes, decide the decision locus for major software purchases at this company: " +
        "'local' (it signs for itself), 'corporate' (a parent decides — name it in `parent`), or 'mixed' (depends / shared). " +
        "parent = the deciding parent's name, or '' if local. note = 1-2 plain sentences a rep can act on. " +
        "source_url = the best URL from the notes ('' if none). confidence reflects the evidence.",
    },
  };

  // STACK fans out: covering six system areas needs more searching than one
  // call can do inside the 300s function budget (an 8-search single call timed
  // out at over ten minutes). Two halves run in parallel instead, so wall-clock
  // is one call's worth and each stays well inside the limit.
  if (key === "stack") {
    // Budget note, learned the hard way: an area-by-area query list makes the
    // model batch every search into ONE code-execution loop. With a small
    // max_uses that burns the whole allowance in a burst and returns nothing
    // ("server tool use limit exceeded"), so the budget has to fit the batch.
    // Parallel calls don't help — the limit is per turn, not concurrency.
    const res = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 10000,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 6 } as any,
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2, max_content_tokens: 18000 } as any,
      ],
      messages: [{ role: "user", content:
        `Which ENTERPRISE SYSTEMS does ${ent.canonical_name} (a US utility/energy company) run TODAY? Public evidence only.` + SEP +
        (atsVendors?.length
          ? `ALREADY CONFIRMED from their own job postings — treat these as established and do not re-verify; spend your searches on the areas NOT covered here:` + NL +
            atsVendors.map((v) => `  - ${v.vendor} (named in ${v.mentions} posting${v.mentions === 1 ? "" : "s"}: ${v.titles.slice(0, 2).join("; ")})`).join(NL) + SEP
          : "") +
        `RUN ONE SEARCH AT A TIME and read each result before the next — do NOT batch several queries into a single code block. ` +
        `Batching burns the whole search allowance in one burst and returns nothing. Stop as soon as you have covered the areas below or run low on searches.` + SEP +
        `SEARCH BY AREA, NOT BY VENDOR — never guess a vendor and look for confirmation; ask what fills each slot:` + NL +
        `  1. "${ent.canonical_name} HCM system" (also "HR system" / "payroll system")` + NL +
        `  2. "${ent.canonical_name} ERP system" (also "finance system" / "general ledger")` + NL +
        `  3. "${ent.canonical_name} asset management system" (EAM / work management)` + NL +
        `  4. "${ent.canonical_name} customer information system" (CIS / billing)` + NL +
        `  5. "${ent.canonical_name} project controls" (capital project scheduling / cost)` + NL +
        `  6. "${ent.canonical_name} procurement system" (sourcing / supply chain)` + SEP +
        `HIGH-VALUE TELLS:` + NL +
        `- THE CAREERS-PORTAL DOMAIN IS NEAR-DEFINITIVE for the HR system: *.oraclecloud.com or fa.*.oraclecloud.com = Oracle Fusion HCM; ` +
        `*.myworkdayjobs.com = Workday; *.sapsf.com / *.successfactors.com = SAP SuccessFactors; taleo.net = Oracle Taleo.` + NL +
        `- THEIR OWN JOB POSTINGS name the systems a team supports ("Oracle HCM Cloud Developer", "SAP FICO Analyst", "Maximo administrator") — the richest single source.` + NL +
        `- Vendor press releases and customer case studies naming them; their 10-K technology discussion.` + SEP +
        `An EXISTING Oracle footprint matters as much as a competitor's — if they already run Oracle anywhere, say so explicitly.` + NL +
        `Report the exact evidence and source URL for each system found. If an area has no real evidence, OMIT it — never infer a vendor from what a utility "typically" runs.` }],
    }, { timeout: DEADLINE_MS });
    usage.push(u("claude-sonnet-5", res.usage));
    const notes = textOf(res);
    if (!notes) throw new Error("research came back empty");

    const ex = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 3500,
      output_config: { format: { type: "json_schema", schema: SCHEMAS.stack } } as any,
      system:
        "Build a competitive picture of the systems this company runs, from the notes ONLY. " +
        "systems = one entry per system with real evidence; evidence = the specific public tell (quote the job-posting title, press-release line, or careers-portal domain); source = the URL; " +
        "confidence: high = vendor case study, their own filing, their own job posting, or their careers-portal domain; medium = trade press or a strong indirect tell; low = inferred. " +
        "incumbent = the primary ERP/finance vendor if the evidence supports one, else 'unclear'. " +
        "angles = 2-4 honest angles for an Oracle ERP/EPM/Primavera seller, grounded in something specific in the notes. " +
        "If they ALREADY run Oracle products, frame the angles as expansion and consolidation (EBS to Fusion, adding EPM or Primavera alongside the existing footprint), NOT displacement — and say so in summary. " +
        "Never invent a system, a customer relationship, or a weakness.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}` + SEP + `Research notes:` + NL + notes.slice(0, 24000) }],
    }, { timeout: DEADLINE_MS });
    usage.push(u("claude-opus-4-8", ex.usage));
    const parsed = JSON.parse(textOf(ex));
    const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const merged = new Map<string, any>();
    for (const sy of parsed.systems ?? []) {
      const id = `${String(sy.vendor).toLowerCase().trim()}|${String(sy.area).toLowerCase().trim()}`;
      const prev = merged.get(id);
      if (!prev) { merged.set(id, sy); continue; }
      merged.set(id, (RANK[sy.confidence] ?? 0) > (RANK[prev.confidence] ?? 0) ? { ...sy, corroborated: true } : { ...prev, corroborated: true });
    }
    parsed.systems = [...merged.values()];
    // A transient tool failure returns a well-formed card with nothing in it.
    // Saving that would overwrite good cached research with "no evidence found".
    if (!parsed.systems.length) throw new Error("no systems found — likely a transient search failure, existing card left untouched");
    return { data: parsed, usage };
  }

  const cfg = CFG[key as Exclude<TaskKey, "comp" | "stack" | "risks">];

  // The research and extract calls used to get DEADLINE_MS EACH, so a task
  // could legitimately run 420s and still blow the 300s function cap — a
  // docket lookup for Con Edison did exactly that at 368s. They share one wall
  // clock now: research may use whatever is left minus a reserve for the
  // extraction, which is the step that turns notes into something storable and
  // must not be the thing that gets cut off.
  const EXTRACT_RESERVE_MS = 45_000;
  const t0 = Date.now();
  const left = (reserve: number) => Math.max(20_000, DEADLINE_MS - (Date.now() - t0) - reserve);

  const research = await client.messages.create({
    model: "claude-sonnet-5", max_tokens: cfg.maxTokens, tools: cfg.tools,
    messages: [{ role: "user", content: cfg.prompt }],
  }, { timeout: left(EXTRACT_RESERVE_MS) });
  usage.push(u("claude-sonnet-5", research.usage));
  const notes = textOf(research);
  if (!notes) throw new Error("research came back empty");

  const extract = await client.messages.create({
    model: cfg.extractModel, max_tokens: cfg.extractTokens,
    output_config: { format: { type: "json_schema", schema: SCHEMAS[key] } } as any,
    system: cfg.system,
    messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nResearch notes:\n${notes.slice(0, cfg.notesCap)}` }],
  }, { timeout: DEADLINE_MS });
  usage.push(u(cfg.extractModel, extract.usage));
  const parsed = JSON.parse(textOf(extract));

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
