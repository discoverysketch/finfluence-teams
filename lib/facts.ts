import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFinancials, type Financials } from "@/lib/edgar";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fetch-or-cache an entity's SEC facts. Reads use the caller's (RLS-scoped) client;
// writes go through the service role since shared-directory entities can't be
// written by a tenant user. Shared by /api/entity-facts and /api/peer-suggest.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const METRICS: (keyof Financials)[] = [
  "revenue", "operatingIncome", "netIncome", "interestExpense",
  "totalAssets", "totalLiabilities", "totalEquity",
  "cash", "currentAssets", "currentLiabilities",
  "totalDebt", "operatingCashFlow", "capex", "cogs",
];

export type FactMap = Record<string, number>;
export type FactsResult =
  | { ok: true; company: string; period: string; source_url: string; facts: FactMap }
  | { ok: false; status: number; error: string };

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function ensureEntityFacts(supabase: SupabaseClient, entityId: string): Promise<FactsResult> {
  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, ticker, cik, data_tier").eq("id", entityId).maybeSingle();
  if (!ent) return { ok: false, status: 404, error: "Entity not found" };

  const { data: existing } = await supabase.from("entity_facts")
    .select("fact_key, value, period, source_url, fetched_at").eq("entity_id", entityId).eq("source", "sec")
    .order("fetched_at", { ascending: false });
  if (existing && existing.length && Date.now() - new Date(existing[0].fetched_at).getTime() < FRESH_MS) {
    return {
      ok: true, company: ent.canonical_name, period: existing[0].period, source_url: existing[0].source_url,
      facts: Object.fromEntries(existing.map((f: any) => [f.fact_key, Number(f.value)])),
    };
  }

  if (!ent.cik && !ent.ticker) return { ok: false, status: 422, error: "No SEC identifier for this account (Tier D — profile flow coming soon)." };
  let fin: Financials | null = null;
  try { fin = ent.cik ? await fetchFinancials({ cik: ent.cik, title: ent.canonical_name }) : await fetchFinancials(ent.ticker as string); } catch { /* below */ }
  if (!fin) return { ok: false, status: 502, error: "Couldn't pull SEC data for this account." };

  const cik = fin.cik || ent.cik;
  const source_url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;
  const rows = METRICS.filter((k) => fin![k] != null)
    .map((k) => ({ entity_id: entityId, source: "sec", fact_key: k as string, period: fin!.period, value: fin![k] as number, unit: "USD_millions", source_url }));

  const admin = createAdminClient();
  await admin.from("entity_facts").delete().eq("entity_id", entityId).eq("source", "sec");
  if (rows.length) await admin.from("entity_facts").insert(rows);

  return { ok: true, company: fin.company, period: fin.period, source_url, facts: Object.fromEntries(rows.map((r) => [r.fact_key, r.value])) };
}
