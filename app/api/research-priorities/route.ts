import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// "What leadership is saying": management's OWN publicly-stated priorities,
// pulled from the latest earnings call + 10-K MD&A/strategy + recent 8-Ks.
// Quotes and sources only — the rep's homework, done. Cached on the shared
// entity (whole team benefits), re-runnable.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          theme: { type: "string" },
          detail: { type: "string" },
          quote: { type: "string" },
          who: { type: "string" },
          source: { type: "string" },
          angle: { type: "string" },
        },
        required: ["theme", "detail", "quote", "who", "source", "angle"],
      },
    },
    as_of: { type: "string" },
  },
  required: ["summary", "priorities", "as_of"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    const research = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 9000,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 3 } as any,
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 } as any,
      ],
      messages: [{
        role: "user",
        content:
          `Research what leadership at ${ent.canonical_name}${ent.ticker ? ` (${ent.ticker})` : ""}${ent.hq_state ? `, a ${ent.hq_state} US utility` : ", a US utility"} is PUBLICLY PRIORITIZING right now. ` +
          `Sources, in order: (1) their MOST RECENT quarterly EARNINGS CALL — search "${ent.canonical_name} earnings call transcript" and read it for what the CEO/CFO emphasize (capital program, O&M / cost discipline, rate cases, technology/digital modernization, load growth, credit); ` +
          `(2) their latest 10-K management discussion (MD&A) and strategy; (3) any recent 8-K on a material strategic move. ` +
          `Budget: ~3 searches + 3 page fetches. For each priority theme capture: a short DIRECT QUOTE from an executive or filing, WHO said it, and the source URL. ` +
          `Focus on things an enterprise-software seller (finance, capital-project, cost, digital systems) could tie value to. Only report what you actually found with a citation.`,
      }],
    }));
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Research came back empty — try again." }, { status: 502 });

    const extract = await withRetry(() => client.messages.create({
      model: "claude-opus-4-8", max_tokens: 3500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "Structure the leadership priorities from the notes. Use ONLY what's cited in the notes — never invent a quote or figure. " +
        "summary = 2 sentences on the strategic posture. Each priority: theme (3-6 words), detail (1-2 sentences), quote (a real direct quote from the notes — keep it short and verbatim), who (name + title if known), source (the URL), " +
        "angle (one line on how an Oracle ERP/EPM/Primavera seller ties value to this priority). as_of = the period/date of the newest source (e.g. 'Q2 2026 earnings call'). Drop any priority lacking a source URL.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nResearch notes:\n${notes.slice(0, 18000)}` }],
    }));
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const parsed = JSON.parse(text);
    parsed.priorities = (parsed.priorities ?? []).filter((p: any) => /^https?:\/\//.test(p.source)).slice(0, 8);
    if (!parsed.priorities.length) return NextResponse.json({ error: "No citable priorities found — try again." }, { status: 502 });

    // Cache on the shared entity via service role.
    const admin = createAdminClient();
    await admin.from("entities").update({ priorities_json: parsed, priorities_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ priorities: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
