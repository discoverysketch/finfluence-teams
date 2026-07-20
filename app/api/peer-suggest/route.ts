import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts, type FactMap } from "@/lib/facts";
import { rankPeers } from "@/lib/lookalike";

// Suggest peers for one account: ensure its facts, pool every entity that already
// has cached SEC facts, rank by financial similarity. Candidate pool is warmed by
// `npm run cache-peers` (a utility universe) plus anything reps have viewed.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(request: Request) {
  const entityId = new URL(request.url).searchParams.get("entityId") || "";
  if (!entityId) return NextResponse.json({ error: "Missing entityId" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const target = await ensureEntityFacts(supabase, entityId);
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: target.status });
  // Fold EIA ops into the target's fact map (eia_* keys) — this is what lets a
  // muni/co-op with zero SEC filings be dueled at all.
  const targetFacts: FactMap = { ...target.facts };
  if (target.eia) for (const [k, v] of Object.entries({ eia_customers: target.eia.facts.customers, eia_revenue: target.eia.facts.revenue, eia_sales_mwh: target.eia.facts.sales_mwh })) {
    if (v != null && isFinite(v)) targetFacts[k] = v;
  }
  if (target.ferc) for (const [k, v] of Object.entries({ ferc_net_plant: target.ferc.facts.net_utility_plant, ferc_cwip: target.ferc.facts.cwip, ferc_om: target.ferc.facts.om_expense, ferc_revenue: target.ferc.facts.electric_revenue })) {
    if (v != null && isFinite(v)) targetFacts[k] = v;
  }

  // Pool: all readable cached SEC + EIA facts (RLS scopes to shared + own).
  const { data: fr } = await supabase.from("entity_facts")
    .select("entity_id, fact_key, value, period, source").in("source", ["sec", "eia", "ferc"]);
  const byEntity: Record<string, { facts: FactMap; period: string }> = {};
  for (const row of (fr ?? []) as any[]) {
    if (row.entity_id === entityId) continue;
    if (String(row.fact_key).startsWith("fy_")) continue;
    const e = (byEntity[row.entity_id] ??= { facts: {}, period: row.period });
    if (row.source === "eia") {
      if (["customers", "revenue", "sales_mwh"].includes(row.fact_key)) e.facts[`eia_${row.fact_key}`] = Number(row.value);
    } else if (row.source === "ferc") {
      const map: Record<string, string> = { net_utility_plant: "ferc_net_plant", cwip: "ferc_cwip", om_expense: "ferc_om", electric_revenue: "ferc_revenue" };
      const k = map[row.fact_key];
      if (k) e.facts[k] = Number(row.value);
    } else {
      e.facts[row.fact_key] = Number(row.value);
      e.period = row.period;
    }
  }
  const ids = Object.keys(byEntity).filter((id) => Object.keys(byEntity[id].facts).length >= 3);
  if (!ids.length) {
    return NextResponse.json({ target: { id: entityId, company: target.company, period: target.period, facts: targetFacts }, peers: [] });
  }

  const { data: ents } = await supabase.from("entities")
    .select("id, canonical_name, ticker, data_tier, entity_type").in("id", ids);
  const meta: Record<string, any> = {};
  for (const e of (ents ?? []) as any[]) meta[e.id] = e;

  const candidates = ids.filter((id) => meta[id]).map((id) => ({
    id, facts: byEntity[id].facts, period: byEntity[id].period,
    canonical_name: meta[id].canonical_name, ticker: meta[id].ticker, data_tier: meta[id].data_tier,
  }));
  // Require at least 2 shared similarity dimensions so single-dim coincidences
  // (e.g. size-only) don't outrank genuinely comparable peers.
  const rankedAll = rankPeers(targetFacts, candidates);
  const solid = rankedAll.filter((p) => p.sharedDims >= 2);
  const ranked = (solid.length >= 3 ? solid : rankedAll).slice(0, 8);

  return NextResponse.json({
    target: { id: entityId, company: target.company, period: target.period, facts: targetFacts },
    peers: ranked.map((p) => ({
      id: p.id, company: p.canonical_name, ticker: p.ticker, data_tier: p.data_tier,
      period: p.period, facts: p.facts, similarity: Math.round(p.similarity * 100),
    })),
  });
}
