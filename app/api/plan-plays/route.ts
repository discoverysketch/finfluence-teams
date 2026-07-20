import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts } from "@/lib/facts";
import { NextResponse } from "next/server";

// Suggested plays for an account plan: Claude drafts 3–4 concrete plays grounded in
// the account's facts, its closest peer, and the rep's weak concepts.
/* eslint-disable @typescript-eslint/no-explicit-any */
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    plays: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title", "detail"] } },
  },
  required: ["plays"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, peerName, peerFacts, weakConcepts } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });

  const { data: ent } = await supabase.from("entities").select("canonical_name, data_tier, profile_json").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const facts = await ensureEntityFacts(supabase, entityId);
  const factLines = facts.ok && Object.keys(facts.facts).length ? Object.entries(facts.facts).map(([k, v]) => `${k}=${v}`).join(", ") : "(no SEC financials)";
  const eiaLine = facts.ok && facts.eia ? `Utility operations (EIA-861 ${facts.eia.period}): ` + Object.entries(facts.eia.facts).map(([k, v]) => `${k}=${v}`).join(", ") : "";
  const fercLine = facts.ok && facts.ferc ? `Regulated financials (FERC Form 1 ${facts.ferc.period}, USD millions): ` + Object.entries(facts.ferc.facts).map(([k, v]) => `${k}=${v}`).join(", ") : "";
  const profileNote = !facts.ok && (ent as any).profile_json ? `Profile: ${JSON.stringify((ent as any).profile_json).slice(0, 800)}` : "";
  const fmt = (f: any) => Object.entries(f || {}).map(([k, v]) => `${k}=${v}`).join(", ");

  const prompt =
    `Draft 3–4 concrete account plays for a B2B enterprise-software rep planning to sell to ${ent.canonical_name}, a US utility. ` +
    `Each play: a short title and 1–2 sentences of detail. Ground them in this account's real position; tie value to what a utility CFO cares about (capex efficiency, credit, returns, customer growth). ` +
    (weakConcepts?.length ? `The rep is still building fluency in ${weakConcepts.join(", ")}, so keep finance framing accessible and specific. ` : "") +
    `Do not invent figures.\n\nAccount ($ millions): ${factLines}\n${eiaLine}\n${fercLine}\n${profileNote}\n` +
    (peerName ? `Closest peer ${peerName}: ${fmt(peerFacts)}` : "");

  try {
    const res = await new Anthropic().messages.create({
      model: "claude-opus-4-8", max_tokens: 1500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json(JSON.parse(text));
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Plays failed — ${msg}` }, { status: 502 });
  }
}
