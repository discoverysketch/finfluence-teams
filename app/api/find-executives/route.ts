import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { canResearch } from "@/lib/canResearch";
import { friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";
import { researchExecutives } from "@/lib/execResearch";

// Executive finder (manual trigger from the Hub): web-researches an account's
// leadership and returns a REVIEWABLE list with source URLs. Nothing saves
// until the rep approves. Names/titles only — no scraped personal contact
// details. Research logic lives in lib/execResearch (shared with the
// background research that runs on account add).
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const gate = await canResearch(supabase, user.id, { accountId });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });
  // RLS scopes this read — resolves only for accounts in the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, entity:entities(canonical_name, hq_state)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  try {
    const executives = await researchExecutives(ent.canonical_name, ent.hq_state);
    if (!executives.length) return NextResponse.json({ error: "No citable leadership info found — this one may need manual entry." }, { status: 502 });
    return NextResponse.json({ executives });
  } catch (e) {
    // Was `${e.status}: ${e.message}`, which put a wall of raw JSON in front of
    // the rep — the spend-cap error rendered as the whole API envelope. Use the
    // same mapping every other research route uses.
    return NextResponse.json({ error: `Executive search failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
