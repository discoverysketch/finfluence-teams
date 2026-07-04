import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts } from "@/lib/facts";
import { NextResponse } from "next/server";

// CFO Simulator (SPEC §6c): Claude role-plays the CFO of the rep's actual account,
// grounded in cached entity_facts. mode "chat" continues the rehearsal in character;
// mode "score" steps out and coaches with a structured rubric.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Msg = { role: "cfo" | "rep"; content: string };

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
