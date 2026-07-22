import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts, fercRateBaseCagr } from "@/lib/facts";
import { loadKnowledge } from "@/lib/knowledge";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Signal-to-outreach: turn a signal (8-K, rate case, news mention) into a short,
// sendable email grounded in the account's real figures. The rep reviews and
// edits before sending — the app never sends anything itself.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { subject: { type: "string" }, body: { type: "string" } },
  required: ["subject", "body"],
};
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId, trigger } = await request.json().catch(() => ({}));
  if (!accountId || !trigger?.title) return NextResponse.json({ error: "Missing account or signal" }, { status: 400 });

  const { data: acct } = await supabase.from("accounts")
    .select("id, crm_stage, entity:entities(id, canonical_name, ticker, decision_locus, decision_note)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [facts, { data: contacts }, kb] = await Promise.all([
    ensureEntityFacts(supabase, ent.id),
    supabase.from("contacts").select("name, title, role_tag, email").eq("account_id", accountId),
    loadKnowledge(supabase),
  ]);

  // Address the most senior deal role we know about.
  const order = ["economic_buyer", "champion", "exec_sponsor", "influencer", "end_user"];
  const recipient = (contacts ?? []).slice().sort((a: any, b: any) =>
    (order.indexOf(a.role_tag) + 1 || 99) - (order.indexOf(b.role_tag) + 1 || 99))[0] ?? null;

  const L: string[] = [];
  L.push(`COMPANY: ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""} · deal stage: ${acct!.crm_stage || "prospect"}`);
  L.push(`THE SIGNAL (reason for this email): ${trigger.date ? `${trigger.date}: ` : ""}${trigger.title}${trigger.detail ? ` — ${trigger.detail}` : ""}`);
  if (facts.ok) {
    const f = facts.facts;
    const keyFigs: string[] = [];
    if (f.fy_revenue != null) keyFigs.push(`FY revenue ${fmtM(f.fy_revenue)}`);
    if (f.fy_capex != null) keyFigs.push(`FY capex ${fmtM(Math.abs(f.fy_capex))}`);
    if (f.fy_operatingCashFlow != null) keyFigs.push(`FY op cash flow ${fmtM(f.fy_operatingCashFlow)}`);
    if (f.totalDebt != null) keyFigs.push(`total debt ${fmtM(f.totalDebt)}`);
    if (facts.ferc) {
      const fr = facts.ferc.facts;
      if (fr.net_utility_plant != null) keyFigs.push(`net utility plant ${fmtM(fr.net_utility_plant)}`);
      const cagr = fercRateBaseCagr(fr);
      if (cagr != null) keyFigs.push(`rate base growing ${(cagr * 100).toFixed(1)}%/yr (5y)`);
      if (fr.cwip != null) keyFigs.push(`CWIP ${fmtM(fr.cwip)}`);
    }
    if (keyFigs.length) L.push(`REAL FIGURES YOU MAY CITE: ${keyFigs.join(", ")}`);
  }
  if (recipient) L.push(`RECIPIENT: ${recipient.name}${recipient.title ? `, ${recipient.title}` : ""}`);
  if (ent.decision_locus === "corporate") L.push(`NOTE: major software decisions are made at the corporate parent${ent.decision_note ? ` (${String(ent.decision_note).slice(0, 200)})` : ""} — frame this as building the local case/champion, not asking for a signature.`);

  const client = new Anthropic();
  try {
    const final = await withRetry(async () => {
      const stream = client.messages.stream({
      model: "claude-opus-4-8", max_tokens: 2500,
      thinking: { type: "adaptive" } as any,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "You write outreach emails for an Oracle rep (Fusion ERP/EPM/SCM, Primavera P6, Aconex) selling to US utilities. " +
        "Draft ONE short email prompted by the SIGNAL below. Rules:\n" +
        "- 90-140 words. Plain text. No bullet lists, no exclamation marks, no 'I hope this finds you well'.\n" +
        "- Open with the signal (specific and factual), connect it to ONE business implication using a real figure from the data, and close with a single low-friction CTA (a 20-minute conversation, not a demo).\n" +
        "- Only figures from REAL FIGURES; only customer references from the PRODUCT KNOWLEDGE BASE (at most one, with the customer's name). Never invent anything.\n" +
        "- Address the recipient by first name if provided, else no salutation name. Sign off exactly with: [Your name].\n" +
        "- subject: under 9 words, specific, no clickbait.\n\n" +
        `PRODUCT KNOWLEDGE BASE (for optional reference):\n${kb.slice(0, 8000) || "(none)"}`,
        messages: [{ role: "user", content: L.join("\n\n") }],
      });
      return stream.finalMessage();
    });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const draft = JSON.parse(text);
    return NextResponse.json({
      draft,
      recipient: recipient ? { name: recipient.name, title: recipient.title, email: recipient.email || null } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: `Draft failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
