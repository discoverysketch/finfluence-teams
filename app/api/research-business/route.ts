import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// "What is this business?" — for accounts the filings do not describe.
//
// A wholly-owned subsidiary or a private company files nothing, so the SEC and
// FERC paths return an empty account. This aims the search where companies like
// that ARE covered: their own careers site, trade press, the local business
// press, and public economic-development filings for facilities they build.
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
    .select("id, canonical_name, ticker, hq_state, cik, sic, entity_type, parent_name").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    const { data: parsed } = await withRetry(() => runTask(client, ent as any, "business"));
    // Same rule as every other facet: nothing without a source ships.
    const cite = (a: any[]) => (a ?? []).filter((x: any) => /^https?:\/\//.test(x.source));
    parsed.scale = cite(parsed.scale).slice(0, 8);
    parsed.developments = cite(parsed.developments).slice(0, 8);
    parsed.systems = cite(parsed.systems).slice(0, 8);
    if (!parsed.developments.length && !parsed.scale.length && !parsed.systems.length) {
      return NextResponse.json({ error: "Nothing citable found on this company — it may be small enough to have no public coverage at all." }, { status: 502 });
    }

    const admin = createAdminClient();
    await admin.from("entities").update({ business_json: parsed, business_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ business: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
