import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts } from "@/lib/facts";

// Facts for every account in the tenant's book (fetch-or-cache each). Bounded by
// book size; cached for 7 days so repeat loads are fast. Feeds Territory Board.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("tenant_id").eq("id", user.id).maybeSingle();

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, entity:entities(id,canonical_name,ticker,data_tier)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");

  const rows = ((accts ?? []) as any[]).filter((a) => a.entity);
  const items = await Promise.all(rows.map(async (a) => {
    const res = await ensureEntityFacts(supabase, a.entity.id);
    return {
      accountId: a.id, entityId: a.entity.id, name: a.entity.canonical_name, ticker: a.entity.ticker,
      tier: a.entity.data_tier as string | null,
      facts: res.ok ? res.facts : {}, period: res.ok ? res.period : null, error: res.ok ? null : res.error,
    };
  }));

  return NextResponse.json({ items });
}
