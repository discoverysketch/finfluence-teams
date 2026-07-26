import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { fetchProxy } from "@/lib/proxy";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// Deep public-data enrichment on the shared entity. Modes:
//  hiring — open finance/ERP/systems roles (buying-intent signal)
//  comp   — exec-compensation metrics from the DEF 14A proxy + employee count
//  fleet  — generation fleet summary (capacity, fuel mix, notable plants)
//  muni   — financial snapshot for non-SEC munis (from EMMA / official docs)
//  stack  — competitive battlecard: systems they appear to run today
//  infer  — pattern-level read for companies that file nothing public
// Web-researched, structured, cached; whole team benefits from one run.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const MODES = ["hiring", "comp", "fleet", "muni", "stack", "infer"];
// fleet + muni only — hiring/comp live in lib/researchTasks.
const SCHEMAS: Record<string, any> = {
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
  fleet: (name) =>
    `Research ${name}'s electricity GENERATION FLEET (US utility). Search EIA data, their 10-K, or company pages. Capture: approximate total generating capacity (MW), the fuel mix (natural gas, coal, nuclear, hydro, wind, solar — approximate % shares), and 2-4 notable/large plants or recent additions/retirements. ` +
    `Budget: 2 searches + 1 fetch. If the utility is transmission/distribution-only with little generation, say so (total_mw 0). Cite a source URL.`,
  muni: (name) =>
    `Research the financial profile of ${name}, a US municipal/public utility with no SEC filings. Search MSRB EMMA (emma.msrb.org) for its bond official statements, plus its CAFR/annual financial report. Capture: annual operating revenue ($M), total outstanding debt/bonds ($M), customers served, and any public bond credit rating (Moody's/S&P/Fitch). ` +
    `Budget: 2-3 searches + up to 2 fetches. Use only figures you can cite. Cite the best source URL (prefer the EMMA official statement or the CAFR).`,
};

const COL: Record<string, [string, string]> = {
  hiring: ["hiring_json", "hiring_at"], comp: ["comp_json", "comp_at"], fleet: ["fleet_json", "fleet_at"], muni: ["muni_json", "muni_at"], stack: ["stack_json", "stack_at"], infer: ["inferred_json", "inferred_at"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, mode } = await request.json().catch(() => ({}));
  if (!entityId || !MODES.includes(mode)) return NextResponse.json({ error: "Missing account or mode" }, { status: 400 });
  const gate = await canResearch(supabase, user.id, { entityId });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state, cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    // comp + hiring come from the shared task definitions (lib/researchTasks)
    // so the in-app buttons and the batch sweep produce identical data. comp
    // is deterministic there: DEF 14A straight from EDGAR, no web search.
    if (mode === "comp" || mode === "hiring" || mode === "stack" || mode === "infer") {
      const { data: parsed } = await withRetry(() => runTask(client, ent as any, mode, fetchProxy));
      const admin = createAdminClient();

      // The battlecard ACCUMULATES. Runs legitimately surface different
      // subsets of an estate — one found CC&B and Cloud EPM, the next found
      // HCM, EBS and Maximo — so replacing the card loses confirmed systems.
      // Union by vendor+area, keeping the higher-confidence entry.
      if (mode === "stack") {
        const { data: prior } = await supabase.from("entities").select("stack_json").eq("id", entityId).maybeSingle();
        const before = (prior?.stack_json as any)?.systems ?? [];
        if (before.length) {
          const RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
          const merged = new Map<string, any>();
          for (const sy of [...before, ...(parsed.systems ?? [])]) {
            const id = `${String(sy.vendor).toLowerCase().trim()}|${String(sy.area).toLowerCase().trim()}`;
            const prev = merged.get(id);
            if (!prev) { merged.set(id, sy); continue; }
            merged.set(id, (RANK[sy.confidence] ?? 0) > (RANK[prev.confidence] ?? 0) ? { ...sy, corroborated: true } : { ...prev, corroborated: true });
          }
          parsed.systems = [...merged.values()];
          parsed.merged_from_runs = true;
        }
      }
      const [jsonCol, atCol] = COL[mode];
      const upd: Record<string, any> = { [jsonCol]: parsed, [atCol]: new Date().toISOString() };
      if (mode === "comp" && Number.isInteger(parsed.employees) && parsed.employees > 0) upd.employees = parsed.employees;
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
