import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { fetchRiskFactors } from "@/lib/proxy";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// "Where they say they're exposed": 10-K Item 1A risk factors.
//
// This one needs no web search at all. Item 1A is a fixed, addressable section
// of a standardized form, so we fetch it by address from EDGAR and slice it,
// exactly as we do for the proxy CD&A and Item 7 MD&A. One extraction call.
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

  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state, cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  if (!ent.cik) return NextResponse.json({ error: "Risk factors come from 10-K Item 1A, so this needs an SEC filer. This account has no CIK on file." }, { status: 400 });

  const client = new Anthropic();
  try {
    const { data: parsed } = await withRetry(() => runTask(client, ent as any, "risks", undefined, undefined, undefined, fetchRiskFactors));
    // Same rule as every other facet: a finding without a source URL doesn't ship.
    parsed.risks = (parsed.risks ?? []).filter((r: any) => /^https?:\/\//.test(r.source)).slice(0, 8);
    if (!parsed.risks.length) return NextResponse.json({ error: "No actionable risk factors found in Item 1A — this filer's risks are all boilerplate." }, { status: 502 });

    const admin = createAdminClient();
    await admin.from("entities").update({ risks_json: parsed, risks_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ risks: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
