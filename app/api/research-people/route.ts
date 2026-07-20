import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { researchExecutives } from "@/lib/execResearch";

// Background people research, kicked off when an account is added to a book
// (CSV match, whitespace add, or Tier D profile save). Stages the found roster
// on the account row (accounts.suggested_execs) so the Hub can show it as a
// pre-filled review list — nothing becomes a contact until the rep approves.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  // RLS scopes this read — resolves only for accounts in the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, execs_status, entity:entities(canonical_name, hq_state)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  // Idempotent: a retried kick (or double-click) never double-spends a search.
  if (acct!.execs_status === "pending" || acct!.execs_status === "ready") {
    return NextResponse.json({ ok: true, skipped: acct!.execs_status });
  }

  const { error: pe } = await supabase.from("accounts").update({ execs_status: "pending" }).eq("id", accountId);
  if (pe) return NextResponse.json({ error: `Couldn't stage research (run migration 0016?): ${pe.message}` }, { status: 500 });

  try {
    const executives = await researchExecutives(ent.canonical_name, ent.hq_state);
    await supabase.from("accounts").update({
      suggested_execs: executives.length ? executives : null,
      execs_status: executives.length ? "ready" : "none",
    }).eq("id", accountId);
    return NextResponse.json({ ok: true, count: executives.length });
  } catch (e) {
    await supabase.from("accounts").update({ execs_status: "error" }).eq("id", accountId);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
