import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts, fercRateBaseCagr } from "@/lib/facts";

// Facts for every account in the tenant's book (fetch-or-cache each). Bounded by
// book size; cached for 7 days so repeat loads are fast. Feeds Territory Board.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const maxDuration = 300; // cold load of a big book fetches many EDGAR docs
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("tenant_id").eq("id", user.id).maybeSingle();

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, owner, entity:entities(id,canonical_name,ticker,data_tier)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");

  const rows = ((accts ?? []) as any[]).filter((a) => a.entity);
  // Bounded concurrency: a big book's first load would otherwise fire one
  // EDGAR fetch per uncached account simultaneously and trip SEC rate limits.
  // Cached accounts (7-day) return instantly, so warm loads stay fast.
  const items: any[] = new Array(rows.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= rows.length) return;
      items[i] = await buildItem(rows[i]);
    }
  };
  const buildItem = async (a: any) => {
    const res = await ensureEntityFacts(supabase, a.entity.id);
    // Fold EIA ops + FERC regulated financials into the fact map (eia_*/ferc_*
    // keys) so the Board can score Tier B accounts and enrich Tier A ones.
    const facts: Record<string, number> = res.ok ? { ...res.facts } : {};
    if (res.ok && res.eia) {
      for (const [k, v] of Object.entries({ eia_customers: res.eia.facts.customers, eia_revenue: res.eia.facts.revenue, eia_sales_mwh: res.eia.facts.sales_mwh })) {
        if (v != null && isFinite(v)) facts[k] = v;
      }
    }
    if (res.ok && res.ferc) {
      for (const [k, v] of Object.entries({ ferc_net_plant: res.ferc.facts.net_utility_plant, ferc_cwip: res.ferc.facts.cwip, ferc_om: res.ferc.facts.om_expense, ferc_revenue: res.ferc.facts.electric_revenue })) {
        if (v != null && isFinite(v)) facts[k] = v;
      }
      const g = fercRateBaseCagr(res.ferc.facts);
      if (g != null) facts.ferc_rate_base_cagr = g;
    }
    return {
      accountId: a.id, entityId: a.entity.id, name: a.entity.canonical_name, ticker: a.entity.ticker,
      tier: a.entity.data_tier as string | null, mine: a.owner === user.id,
      facts, period: res.ok ? res.period : null, error: res.ok ? null : res.error,
    };
  };
  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, () => worker()));

  return NextResponse.json({ items });
}
