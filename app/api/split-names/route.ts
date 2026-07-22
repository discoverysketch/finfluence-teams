import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Rescue for merged-cell pastes: a wall of run-together company names with no
// separators (one giant Excel cell) gets split into a clean list by the model,
// then flows into the normal match-and-review pipeline. Cheap (one small
// Sonnet call), and the rep still reviews every match before anything saves.
export const maxDuration = 60;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: { names: { type: "array", items: { type: "string" } } },
  required: ["names"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { text } = await request.json().catch(() => ({}));
  if (!String(text || "").trim()) return NextResponse.json({ error: "Nothing to split" }, { status: 400 });

  const client = new Anthropic();
  try {
    const final = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "The text below is a run-together list of company names (pasted from a spreadsheet with lost separators). " +
        "Split it into individual company names. Company suffixes (Inc, LLC, Corp, Company, Holdings, d/b/a ...) belong " +
        "with the name before them. Keep each name exactly as written. Skip obvious non-name fragments. Up to 300 names.",
      messages: [{ role: "user", content: String(text).slice(0, 20000) }],
    }));
    const out = JSON.parse(final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join(""));
    const names = (out.names ?? []).map((s: any) => String(s).trim()).filter((s: string) => s.length >= 2 && s.length <= 80).slice(0, 300);
    if (!names.length) return NextResponse.json({ error: "Couldn't find company names in that text." }, { status: 422 });
    return NextResponse.json({ names });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't split the text — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
