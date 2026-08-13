import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// What a public body is buying. An RFP for an ERP replacement is not an
// inference about a possible deal — it is a live one with a closing date, and
// public agencies are obliged to publish it.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const gate = await canResearch(supabase, user.id, { entityId });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, ticker, hq_state, cik, sic, entity_type, website").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    const { data: parsed } = await withRetry(() => runTask(client, ent as any, "municipal"));
    const cite = (a: any[]) => (a ?? []).filter((x: any) => /^https?:\/\//.test(x.source));
    parsed.solicitations = cite(parsed.solicitations).slice(0, 10);
    parsed.board_items = cite(parsed.board_items).slice(0, 8);
    parsed.budget_signals = cite(parsed.budget_signals).slice(0, 8);
    if (!parsed.solicitations.length && !parsed.board_items.length && !parsed.budget_signals.length) {
      return NextResponse.json({ error: "Nothing citable found in their published procurement or board records." }, { status: 502 });
    }

    const admin = createAdminClient();
    await admin.from("entities").update({ municipal_json: parsed, municipal_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ municipal: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
