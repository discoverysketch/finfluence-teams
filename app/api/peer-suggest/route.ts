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

  // Pool: all readable cached SEC facts (RLS scopes to shared + own entities).
  const { data: fr } = await supabase.from("entity_facts")
    .select("entity_id, fact_key, value, period").eq("source", "sec");
  const byEntity: Record<string, { facts: FactMap; period: string }> = {};
  for (const row of (fr ?? []) as any[]) {
    if (row.entity_id === entityId) continue;
    (byEntity[row.entity_id] ??= { facts: {}, period: row.period }).facts[row.fact_key] = Number(row.value);
  }
  const ids = Object.keys(byEntity).filter((id) => Object.keys(byEntity[id].facts).length >= 3);
  if (!ids.length) {
    return NextResponse.json({ target: { id: entityId, company: target.company, period: target.period, facts: target.facts }, peers: [] });
  }

  const { data: ents } = await supabase.from("entities")
    .select("id, canonical_name, ticker, data_tier, entity_type").in("id", ids);
  const meta: Record<string, any> = {};
  for (const e of (ents ?? []) as any[]) meta[e.id] = e;

  const candidates = ids.filter((id) => meta[id]).map((id) => ({
    id, facts: byEntity[id].facts, period: byEntity[id].period,
    canonical_name: meta[id].canonical_name, ticker: meta[id].ticker, data_tier: meta[id].data_tier,
  }));
  const ranked = rankPeers(target.facts, candidates).slice(0, 8);

  return NextResponse.json({
    target: { id: entityId, company: target.company, period: target.period, facts: target.facts },
    peers: ranked.map((p) => ({
      id: p.id, company: p.canonical_name, ticker: p.ticker, data_tier: p.data_tier,
      period: p.period, facts: p.facts, similarity: Math.round(p.similarity * 100),
    })),
  });
}
