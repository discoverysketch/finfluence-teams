import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ensureEntityFacts, fercRateBaseCagr } from "@/lib/facts";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Win wire: when a deal closes won, turn the account's data + the rep's
// activity log into an internal win story. The rep reviews/edits the draft,
// then it saves as a card in the "Team Win Wires" unit of the tenant's content
// pack — where it feeds the Path, the CFO coach's knowledge base, and future
// proof points. Wins compound.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    front: { type: "string" },
    whatItIs: { type: "string" },
    worked: { type: "string" },
    utility: { type: "string" },
  },
  required: ["front", "whatItIs", "worked", "utility"],
};
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me?.tenant_id) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const { accountId, mode } = body;

  // ---- save mode: reviewed card -> "Team Win Wires" unit (find or create) ----
  if (mode === "save") {
    const card = body.card;
    if (!card?.front || !card?.body_json) return NextResponse.json({ error: "Missing card" }, { status: 400 });
    const admin = createAdminClient();
    const { data: pack } = await admin.from("content_packs").select("id").eq("tenant_id", me.tenant_id).eq("is_default", true).maybeSingle();
    if (!pack) return NextResponse.json({ error: "No content pack for this tenant." }, { status: 422 });
    let { data: unit } = await admin.from("units").select("id").eq("pack_id", pack.id).ilike("title", "%win wire%").maybeSingle();
    if (!unit) {
      const { count } = await admin.from("units").select("id", { count: "exact", head: true }).eq("pack_id", pack.id);
      const { data: created, error: ue } = await admin.from("units")
        .insert({ pack_id: pack.id, title: "Team Win Wires", order: count ?? 99, icon: "🏆", is_seeded: false }).select("id").single();
      if (ue || !created) return NextResponse.json({ error: ue?.message || "Couldn't create the unit" }, { status: 500 });
      unit = created;
    }
    const { count: cardCount } = await admin.from("cards").select("id", { count: "exact", head: true }).eq("unit_id", unit.id);
    const { error: ce } = await admin.from("cards").insert({
      unit_id: unit.id, type: "flashcard", order: cardCount ?? 0, is_seeded: false,
      front: String(card.front).slice(0, 200), concept_tag: null, body_json: card.body_json,
    });
    if (ce) return NextResponse.json({ error: ce.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // ---- draft mode: generate the story from account data + activity log ----
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });
  const { data: acct } = await supabase.from("accounts")
    .select("id, crm_stage, rep_notes, entity:entities(id, canonical_name, ticker, entity_type, hq_state)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [facts, { data: acts }, { data: contacts }] = await Promise.all([
    ensureEntityFacts(supabase, ent.id),
    supabase.from("activities").select("kind, body, created_at").eq("account_id", accountId).order("created_at", { ascending: true }).limit(40),
    supabase.from("contacts").select("name, title, role_tag").eq("account_id", accountId),
  ]);

  const L: string[] = [];
  L.push(`CUSTOMER: ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""} · ${ent.entity_type || "utility"}${ent.hq_state ? ` · ${ent.hq_state}` : ""}`);
  if (acct!.rep_notes) L.push(`REP NOTES: ${String(acct!.rep_notes).slice(0, 500)}`);
  if (facts.ok) {
    const f = facts.facts, bits: string[] = [];
    if (f.fy_revenue != null) bits.push(`FY revenue ${fmtM(f.fy_revenue)}`);
    if (f.fy_capex != null) bits.push(`FY capex ${fmtM(Math.abs(f.fy_capex))}`);
    if (facts.ferc) {
      const g = fercRateBaseCagr(facts.ferc.facts);
      if (facts.ferc.facts.net_utility_plant != null) bits.push(`rate base ${fmtM(facts.ferc.facts.net_utility_plant)}${g != null ? ` growing ${(g * 100).toFixed(1)}%/yr` : ""}`);
    }
    if (facts.eia?.facts.customers) bits.push(`${Math.round(facts.eia.facts.customers / 1000)}k customers`);
    if (bits.length) L.push(`COMPANY SCALE: ${bits.join(", ")}`);
  }
  if ((contacts ?? []).length) L.push(`PEOPLE INVOLVED: ${(contacts ?? []).map((c: any) => `${c.name} (${c.title || "?"})`).join(", ")}`);
  if ((acts ?? []).length) L.push(`DEAL HISTORY (the rep's own log, oldest first):\n${(acts ?? []).map((a: any) => `- ${String(a.created_at).slice(0, 10)} ${a.kind}: ${String(a.body).slice(0, 180)}`).join("\n")}`);

  const client = new Anthropic();
  try {
    const final = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-8", max_tokens: 2500,
        thinking: { type: "adaptive" } as any,
        output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
        system:
          "Write an INTERNAL win wire for an Oracle utility-vertical sales team: the deal at the company below just closed WON. Rules:\n" +
          "- Ground everything in the data; never invent products sold, deal sizes, dates, or quotes. If the log doesn't say what was sold, describe the pain/context that drove the win instead.\n" +
          "- front: punchy title, format 'WIN: {Company} — {6-10 word hook}'.\n" +
          "- whatItIs: 1-2 sentences — who the customer is (with a real scale figure) and what the win was.\n" +
          "- worked: the story, 3-6 sentences — the pain, how the team sold it (from the deal history), the champion/economic buyer by name if known. This is the part reps will retell.\n" +
          "- utility: 1-2 sentences — how OTHER reps should use this win in their own utility deals.\n" +
          "Confident, concrete, zero fluff.",
        messages: [{ role: "user", content: L.join("\n\n") }],
      });
      return stream.finalMessage();
    });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ draft: JSON.parse(text) });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't draft the win wire — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
