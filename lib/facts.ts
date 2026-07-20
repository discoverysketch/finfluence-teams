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
// EIA-861 utility operations (customers, MWh, revenue by class) — loaded by
// seed/load-eia.mjs for matched entities; present for munis/co-ops (Tier B) and
// many SEC utilities alike.
export type EiaOps = { period: string; source_url: string; asOf: string; facts: FactMap };
export type FactsResult =
  | { ok: true; company: string; period: string; source_url: string; facts: FactMap; asOf: string; annualLabel: string | null; eia: EiaOps | null; ferc: EiaOps | null }
  | { ok: false; status: number; error: string };
const FY_FLOW = ["revenue", "operatingIncome", "netIncome", "operatingCashFlow", "capex"];

async function getSource(supabase: SupabaseClient, entityId: string, source: "eia" | "ferc"): Promise<EiaOps | null> {
  const { data } = await supabase.from("entity_facts")
    .select("fact_key, value, period, source_url, fetched_at").eq("entity_id", entityId).eq("source", source);
  if (!data?.length) return null;
  return {
    period: data[0].period, source_url: data[0].source_url, asOf: data[0].fetched_at,
    facts: Object.fromEntries(data.map((f: any) => [f.fact_key, Number(f.value)])),
  };
}
const getEia = (s: SupabaseClient, id: string) => getSource(s, id, "eia");

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function ensureEntityFacts(supabase: SupabaseClient, entityId: string): Promise<FactsResult> {
  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, ticker, cik, data_tier").eq("id", entityId).maybeSingle();
  if (!ent) return { ok: false, status: 404, error: "Entity not found" };

  const [eia, ferc] = await Promise.all([getEia(supabase, entityId), getSource(supabase, entityId, "ferc")]);
  const eiaOnly = (): FactsResult => ({
    ok: true, company: ent.canonical_name, period: eia ? `EIA-861 ${eia.period}` : `FERC Form 1 ${ferc!.period}`, source_url: (eia ?? ferc)!.source_url,
    facts: {}, asOf: (eia ?? ferc)!.asOf, annualLabel: null, eia, ferc,
  });

  const { data: existing } = await supabase.from("entity_facts")
    .select("fact_key, value, period, source_url, fetched_at").eq("entity_id", entityId).eq("source", "sec")
    .order("fetched_at", { ascending: false });
  // Re-fetch if the cache predates the fy_* (annual) rows, so the FY view populates.
  const hasFy = !!existing?.some((f: any) => String(f.fact_key).startsWith("fy_"));
  if (existing && existing.length && hasFy && Date.now() - new Date(existing[0].fetched_at).getTime() < FRESH_MS) {
    const fyRow = existing.find((f: any) => String(f.fact_key).startsWith("fy_"));
    return {
      ok: true, company: ent.canonical_name, period: existing[0].period, source_url: existing[0].source_url,
      facts: Object.fromEntries(existing.map((f: any) => [f.fact_key, Number(f.value)])),
      asOf: existing[0].fetched_at, annualLabel: fyRow?.period ?? null, eia, ferc,
    };
  }

  if (!ent.cik && !ent.ticker) {
    if (eia || ferc) return eiaOnly();
    return { ok: false, status: 422, error: "No SEC or EIA data for this account yet (Tier D profile only)." };
  }
  let fin: Financials | null = null;
  try { fin = ent.cik ? await fetchFinancials({ cik: ent.cik, title: ent.canonical_name }) : await fetchFinancials(ent.ticker as string); } catch { /* below */ }
  if (!fin) {
    if (eia || ferc) return eiaOnly();
    return { ok: false, status: 502, error: "Couldn't pull SEC data for this account." };
  }

  const cik = fin.cik || ent.cik;
  const source_url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;
  const rows = METRICS.filter((k) => fin![k] != null)
    .map((k) => ({ entity_id: entityId, source: "sec", fact_key: k as string, period: fin!.period, value: fin![k] as number, unit: "USD_millions", source_url }));
  // Full-fiscal-year flow figures, stored as fy_* keys with the FY label as period.
  if (fin.fy) for (const k of FY_FLOW) { const v = (fin.fy as any)[k]; if (v != null) rows.push({ entity_id: entityId, source: "sec", fact_key: `fy_${k}`, period: fin.fy.label, value: v, unit: "USD_millions", source_url }); }

  const admin = createAdminClient();
  await admin.from("entity_facts").delete().eq("entity_id", entityId).eq("source", "sec");
  if (rows.length) await admin.from("entity_facts").insert(rows);

  return { ok: true, company: fin.company, period: fin.period, source_url, facts: Object.fromEntries(rows.map((r) => [r.fact_key, r.value])), asOf: new Date().toISOString(), annualLabel: fin.fy?.label ?? null, eia, ferc };
}
