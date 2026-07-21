import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts, fercRateBaseCagr } from "@/lib/facts";
import { loadKnowledge } from "@/lib/knowledge";
import { classifyFiling } from "@/lib/signalTypes";
import { NextResponse } from "next/server";

// Pre-call brief: one page synthesized from everything the app already knows
// about the account — financials + trends, fresh signals, org chart, activity
// log, Tier D profile — grounded strictly in that data plus the tenant's
// approved product knowledge. Nothing here is fabricated; sections with no
// data say so plainly.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" },
    situation: { type: "array", items: { type: "string" } },
    money: { type: "array", items: { type: "string" } },
    people: { type: "array", items: { type: "string" } },
    opener: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    proof: { type: "string" },
  },
  required: ["headline", "situation", "money", "people", "opener", "questions", "proof"],
};

const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });

  // RLS scopes all reads to the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, crm_stage, rep_notes, entity:entities(id, canonical_name, ticker, hq_state, entity_type, data_tier, profile_json)")
    .eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [facts, { data: filings }, { data: news }, { data: contacts }, { data: acts }, kb] = await Promise.all([
    ensureEntityFacts(supabase, ent.id),
    supabase.from("filing_events").select("form, filed, items, label").eq("entity_id", ent.id).gte("filed", since).order("filed", { ascending: false }).limit(6),
    supabase.from("news_items").select("headline, summary, category, companies, published, created_at").order("created_at", { ascending: false }).limit(30),
    supabase.from("contacts").select("name, title, role_tag, reports_to").eq("account_id", accountId),
    supabase.from("activities").select("kind, body, done, due_at, created_at").eq("account_id", accountId).order("created_at", { ascending: false }).limit(12),
    loadKnowledge(supabase),
  ]);

  // --- compose the grounding data, section by section ---
  const L: string[] = [];
  L.push(`ACCOUNT: ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""} · ${ent.entity_type || "utility"}${ent.hq_state ? ` · HQ ${ent.hq_state}` : ""} · data tier ${ent.data_tier || "?"}`);
  L.push(`DEAL STAGE: ${acct!.crm_stage || "prospect"}`);
  if (acct!.rep_notes) L.push(`REP NOTES: ${String(acct!.rep_notes).slice(0, 600)}`);
  if (ent.profile_json?.summary) L.push(`RESEARCHED PROFILE: ${String(ent.profile_json.summary).slice(0, 700)}`);

  if (facts.ok) {
    const f = facts.facts;
    const rows = Object.entries(f).filter(([k]) => !k.startsWith("fy_")).map(([k, v]) => `${k}=${v}`);
    if (rows.length) L.push(`SEC FINANCIALS ($M, ${facts.period}): ${rows.join(", ")}`);
    const fyRows = Object.entries(f).filter(([k]) => k.startsWith("fy_")).map(([k, v]) => `${k.slice(3)}=${v}`);
    if (fyRows.length) L.push(`FULL FISCAL YEAR ${facts.annualLabel} ($M): ${fyRows.join(", ")}`);
    if (facts.eia) {
      const e = facts.eia.facts;
      L.push(`UTILITY OPERATIONS (EIA-861 ${facts.eia.period}): customers=${e.customers ?? "?"}, sales_mwh=${e.sales_mwh ?? "?"}, retail_revenue_$M=${e.revenue ?? "?"}`);
    }
    if (facts.ferc) {
      const fr = facts.ferc.facts;
      const cagr = fercRateBaseCagr(fr);
      L.push(`REGULATED FINANCIALS (FERC Form 1 ${facts.ferc.period}): net_utility_plant=${fr.net_utility_plant != null ? fmtM(fr.net_utility_plant) : "?"} (rate-base proxy), CWIP=${fr.cwip != null ? fmtM(fr.cwip) : "?"}, electric_OM=${fr.om_expense != null ? fmtM(fr.om_expense) : "?"}, electric_revenue=${fr.electric_revenue != null ? fmtM(fr.electric_revenue) : "?"}${cagr != null ? `, rate_base_growth=${(cagr * 100).toFixed(1)}%/yr over 5y` : ""}`);
    }
  }

  const sigLines: string[] = [];
  for (const ev of (filings ?? []) as any[]) {
    const s = classifyFiling(ev.form, ev.items);
    sigLines.push(`- ${ev.filed}: ${ev.label || s?.label || `${ev.form} filed`} (SEC ${ev.form})`);
  }
  const nm = ent.canonical_name.toLowerCase();
  const keys = [ent.ticker?.toLowerCase(), nm.split(/\s+/).filter((w: string) => w.length > 3).slice(0, 2).join(" ")].filter((s) => s && s.length > 3) as string[];
  for (const n of (news ?? []) as any[]) {
    const hay = `${n.headline} ${n.companies || ""} ${n.summary || ""}`.toLowerCase();
    if (keys.some((k) => hay.includes(k))) sigLines.push(`- ${n.published || "recent"}: ${n.headline}${n.category === "rates" ? " [RATE CASE]" : ""} — ${String(n.summary || "").slice(0, 200)}`);
  }
  L.push(sigLines.length ? `RECENT SIGNALS (filings + news):\n${sigLines.join("\n")}` : "RECENT SIGNALS: none in the last 120 days.");

  const ROLE: Record<string, string> = { economic_buyer: "economic buyer", champion: "champion", exec_sponsor: "exec sponsor", influencer: "influencer", end_user: "user", blocker: "blocker" };
  L.push((contacts ?? []).length
    ? `KNOWN PEOPLE:\n${(contacts ?? []).map((c: any) => `- ${c.name} — ${c.title || "?"}${c.role_tag ? ` [${ROLE[c.role_tag] || c.role_tag}]` : ""}`).join("\n")}`
    : "KNOWN PEOPLE: none mapped yet.");
  if ((acts ?? []).length) {
    L.push(`ACTIVITY LOG (newest first):\n${(acts ?? []).map((a: any) => `- ${String(a.created_at).slice(0, 10)} ${a.kind}${a.kind === "task" ? (a.done ? " (done)" : " (open)") : ""}: ${String(a.body).slice(0, 160)}`).join("\n")}`);
  }

  const client = new Anthropic();
  try {
    const stream = client.messages.stream({
      model: "claude-opus-4-8", max_tokens: 3500,
      thinking: { type: "adaptive" } as any,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "You are an elite enterprise-sales strategist preparing an Oracle rep (Fusion ERP/EPM/SCM, Primavera P6, Aconex) for a meeting at a US utility. " +
        "Write a tight pre-call brief from the ACCOUNT DATA below. Rules:\n" +
        "- Ground EVERY claim in the provided data; quote real figures. Never invent numbers, names, events, or dates.\n" +
        "- headline: one sentence — the single strongest why-now for this account.\n" +
        "- situation: 3-5 short bullets — deal stage, company posture, and what the recent signals mean. If there are no signals, say so.\n" +
        "- money: 2-4 bullets — the financial story that matters to this sale (rate-base growth, capex/CWIP, O&M, debt, cash), each with its actual figure.\n" +
        "- people: 2-4 bullets — who matters and why, AND any gap (e.g. no economic buyer identified, CFO not yet engaged).\n" +
        "- opener: 2-3 sentences the rep could actually say to open the meeting — specific to this account's numbers/signals, no generic pleasantries.\n" +
        "- questions: exactly 3 discovery questions, each tied to a specific data point.\n" +
        "- proof: ONE customer story from the PRODUCT KNOWLEDGE BASE that best fits this account's situation, with its source if given; empty string if none fits. Never invent a story.\n" +
        "Plain, confident sentences. No fluff, no hedging boilerplate.\n\n" +
        `PRODUCT KNOWLEDGE BASE:\n${kb.slice(0, 14000) || "(none loaded)"}`,
      messages: [{ role: "user", content: `ACCOUNT DATA:\n\n${L.join("\n\n")}` }],
    });
    const final = await stream.finalMessage();
    if (final.stop_reason === "max_tokens") return NextResponse.json({ error: "Brief ran long — try again." }, { status: 502 });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ brief: JSON.parse(text), generatedAt: new Date().toISOString() });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Brief generation failed — ${msg}` }, { status: 502 });
  }
}
