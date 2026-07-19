import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts } from "@/lib/facts";
import { NextResponse } from "next/server";

// CFO Simulator (SPEC §6c): Claude role-plays the CFO of the rep's actual account,
// grounded in cached entity_facts. mode "chat" continues the rehearsal in character;
// mode "score" steps out and coaches with a structured rubric; mode "coach" is a
// mid-meeting sales coach grounded in the tenant's approved Solutions content.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Msg = { role: "cfo" | "rep"; content: string };

const COACH_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    answer: { type: "string" },
    why: { type: "array", items: { type: "string" } },
    proof: { type: "string" },
  },
  required: ["answer", "why", "proof"],
};

// Product knowledge = the tenant's own admin-approved content cards (Solutions
// decks: Fusion ERP/EPM/SCM/Energy & Water, customer win stories). Keeps coach
// suggestions anchored to vetted material rather than model memory.
async function loadKnowledge(supabase: any): Promise<string> {
  const { data: pack } = await supabase.from("content_packs").select("id").eq("is_default", true).maybeSingle();
  if (!pack) return "";
  const { data: units } = await supabase.from("units").select("id,title").eq("pack_id", pack.id);
  const rel = (units ?? []).filter((u: any) => /oracle|fusion|erp|epm|scm|hcm|cx|integration|energy|water|use case|customer|win/i.test(u.title));
  if (!rel.length) return "";
  const { data: cards } = await supabase.from("cards")
    .select("front, body_json, unit_id").in("unit_id", rel.map((u: any) => u.id)).limit(120);
  const titleOf: Record<string, string> = {};
  for (const u of rel) titleOf[u.id] = u.title;
  return (cards ?? []).map((c: any) => {
    const b = c.body_json || {};
    const bits = [b.whatItIs, b.whyItMatters, b.link, b.utility, b.worked].filter(Boolean).join(" ");
    return `[${titleOf[c.unit_id]}] ${c.front}: ${String(bits).slice(0, 320)}`;
  }).join("\n");
}

const SCORE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    financialFluency: { type: "integer" }, businessRelevance: { type: "integer" }, composure: { type: "integer" }, overall: { type: "integer" },
    coaching: { type: "array", items: { type: "string" } },
    nextTime: { type: "string" },
    conceptsTested: { type: "array", items: { type: "string", enum: ["prof", "liq", "ret", "cash", "found"] } },
    passed: { type: "boolean" },
  },
  required: ["financialFluency", "businessRelevance", "composure", "overall", "coaching", "nextTime", "conceptsTested", "passed"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, messages, mode } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });

  const target = await ensureEntityFacts(supabase, entityId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
  if (Object.keys(target.facts).length < 3) return NextResponse.json({ error: "Not enough financial data to ground a CFO for this account." }, { status: 422 });

  const factLines = Object.entries(target.facts).map(([k, v]) => `- ${k}: ${v}`).join("\n");
  const history = (messages ?? []) as Msg[];
  const client = new Anthropic();

  if (mode === "coach") {
    const transcript = history.slice(-8).map((m) => `${m.role === "cfo" ? "CFO" : "REP"}: ${m.content}`).join("\n\n");
    const kb = await loadKnowledge(supabase);
    const sys =
      `You are an elite Oracle sales coach whispering in a rep's ear during a rehearsal meeting with the CFO of ${target.company}, a US utility. ` +
      `Craft what the rep should SAY next, answering the CFO's most recent question head-on.\n` +
      `Rules:\n` +
      `- Ground value claims in the PRODUCT KNOWLEDGE BASE below (the team's approved content) whenever it covers the topic; for capital-project questions you may also draw on Oracle Primavera P6 and Aconex (established products). Prefer current product names as given in the knowledge base.\n` +
      `- Tie the answer to the CFO's OWN numbers (below) — never invent figures about their company.\n` +
      `- 'answer' = 2-4 speakable sentences in the rep's voice: direct, concrete, quantified where honest, ending with a question that advances discovery when natural.\n` +
      `- 'why' = 2-3 short bullets naming the selling principle at work (e.g. anchor to their capex program, answer-then-advance, name the P&L line).\n` +
      `- 'proof' = one customer proof point from the knowledge base — STRONGLY prefer utility/energy/water customers (this buyer is a utility CFO; a SaaS or logistics story lands flat). Only use a cross-industry story if no utility one fits the topic, and then name its industry explicitly. Else "".\n\n` +
      `CFO's company figures ($ millions):\n${factLines}\n\n` +
      `PRODUCT KNOWLEDGE BASE:\n${kb || "(none loaded — rely on well-established Oracle product facts only, conservatively)"}`;
    try {
      const res = await client.messages.create({
        model: "claude-opus-4-8", max_tokens: 1500,
        output_config: { format: { type: "json_schema", schema: COACH_SCHEMA } } as any,
        system: sys,
        messages: [{ role: "user", content: `Meeting so far:\n\n${transcript || "(the CFO just greeted the rep)"}\n\nWhat should the rep say next?` }],
      });
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
      return NextResponse.json({ coach: JSON.parse(text) });
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
      return NextResponse.json({ error: `Coach unavailable — ${msg}` }, { status: 502 });
    }
  }

  if (mode === "score") {
    const transcript = history.map((m) => `${m.role === "cfo" ? "CFO" : "REP"}: ${m.content}`).join("\n\n");
    const sys =
      `You are a sharp sales coach. A rep just rehearsed a meeting with the CFO of ${target.company} (a utility). ` +
      `Score the rep 0–100 on financialFluency (did they use the company's real numbers correctly and understand the business?), ` +
      `businessRelevance (did they tie value to what a utility CFO actually cares about — rate base, capex, credit, customers?), and composure. ` +
      `Give an overall 0–100, 2–3 specific coaching bullets, one concrete thing to try next time, ` +
      `the finance concepts genuinely tested (subset of prof=profitability, liq=liquidity/leverage, ret=returns, cash=cash/capital, found=foundations), ` +
      `and passed=true if overall>=60. Company figures ($ millions):\n${factLines}`;
    try {
      const res = await client.messages.create({
        model: "claude-opus-4-8", max_tokens: 2000,
        output_config: { format: { type: "json_schema", schema: SCORE_SCHEMA } },
        system: sys,
        messages: [{ role: "user", content: `Transcript:\n\n${transcript}` }],
      });
      const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
      return NextResponse.json({ score: JSON.parse(text) });
    } catch (e) {
      const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
      return NextResponse.json({ error: `Scoring failed — ${msg}` }, { status: 502 });
    }
  }

  // chat mode — stay in character as the CFO
  const sys =
    `You ARE the CFO of ${target.company}, a US utility. You're in a short meeting with a B2B enterprise-software sales rep. ` +
    `Stay fully in character: sharp, time-pressed, fair, and grounded in YOUR company's real numbers below. Ask pointed questions that test whether the rep understands your business and financials — reference specific figures. ` +
    `One question at a time. Keep every turn to 2–4 sentences. Never coach, never break character, never mention you are an AI. Your figures ($ millions):\n${factLines}`;
  const apiMessages: Anthropic.MessageParam[] = [
    { role: "user", content: "The rep just sat down across from you. Greet them in one line and ask your first pointed question, grounded in your financials." },
    ...history.map((m) => ({ role: (m.role === "cfo" ? "assistant" : "user") as "assistant" | "user", content: m.content })),
  ];
  try {
    const res = await client.messages.create({ model: "claude-opus-4-8", max_tokens: 500, system: sys, messages: apiMessages });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
    return NextResponse.json({ reply: text });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `CFO is unavailable — ${msg}` }, { status: 502 });
  }
}
