import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Business-case narrative: the CLIENT computes all savings math from the
// account's real figures + the rep's assumptions; the model only writes the
// story around numbers it is handed. It cannot invent or alter a figure.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    risks: { type: "string" },
    cfo_line: { type: "string" },
  },
  required: ["headline", "rationale", "risks", "cfo_line"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, model } = await request.json().catch(() => ({}));
  if (!entityId || !model) return NextResponse.json({ error: "Missing inputs" }, { status: 400 });
  const { data: ent } = await supabase.from("entities").select("canonical_name").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    const final = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-8", max_tokens: 2500,
        thinking: { type: "adaptive" } as any,
        output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
        system:
          `Write the narrative for a CFO-ready business case at ${ent.canonical_name}, a US utility, for Oracle Fusion ERP/EPM + Primavera. Rules:\n` +
          "- Use ONLY the figures provided (their real financials + the rep's stated assumptions + the computed results). Quote them as given; never invent, recompute, or embellish a number.\n" +
          "- headline: one sentence — the value story in plain CFO language.\n" +
          "- rationale: 3-5 bullets, each tying one savings lever to the company's OWN baseline figure and naming the assumption honestly (e.g. 'a 1.5% efficiency assumption on their $X O&M base').\n" +
          "- risks: 1-2 honest sentences on what could make the numbers smaller — assumption sensitivity, adoption, timeline. Credibility beats hype.\n" +
          "- cfo_line: one sentence the rep could say verbatim to open the business-case conversation.\n" +
          "Confident, conservative, zero fluff. This document's power is that every number is either theirs or a stated assumption.",
        messages: [{ role: "user", content: `FIGURES AND ASSUMPTIONS (all $ millions unless noted):\n${JSON.stringify(model, null, 2)}` }],
      });
      return stream.finalMessage();
    });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ narrative: JSON.parse(text) });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't write the case — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
