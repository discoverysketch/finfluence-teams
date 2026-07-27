import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { commissionsFor } from "@/lib/dockets";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// "What they're asking regulators for": the most recent general rate case.
//
// Unlike the SEC facets this one cannot be deterministic — there is no national
// index of dockets and every state commission runs its own filing system. What
// we can do is aim the search: lib/dockets maps the company to the commissions
// it actually files with (a holding company's HQ state is usually not the whole
// story — AEP files in ten states), so the search is scoped to the right
// domains instead of the open web.
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

  const client = new Anthropic();
  try {
    const comms = commissionsFor(ent.canonical_name, ent.hq_state);
    const { data: parsed } = await withRetry(() => runTask(client, ent as any, "dockets", undefined, undefined, undefined, undefined, comms));
    // A docket number without a source is worse than no docket number — a rep
    // could quote it to a regulator-facing customer and be wrong.
    parsed.cases = (parsed.cases ?? []).filter((c: any) => /^https?:\/\//.test(c.source)).slice(0, 3);
    if (!parsed.cases.length) return NextResponse.json({ error: "No citable rate case found. Not every company in the book is rate-regulated." }, { status: 502 });

    const admin = createAdminClient();
    await admin.from("entities").update({ dockets_json: parsed, dockets_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ dockets: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
