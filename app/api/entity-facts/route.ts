import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchFinancials, type Financials } from "@/lib/edgar";

// Cached SEC facts for one entity. Reads are RLS-scoped to the caller; writes go
// through the service role because shared-directory entities (created_by_tenant IS
// NULL) can't be written by a tenant user — their facts are shared across tenants.
const FRESH_MS = 7 * 24 * 60 * 60 * 1000;
const METRICS: (keyof Financials)[] = [
  "revenue", "operatingIncome", "netIncome", "interestExpense",
  "totalAssets", "totalLiabilities", "totalEquity",
  "cash", "currentAssets", "currentLiabilities",
  "totalDebt", "operatingCashFlow", "capex", "cogs",
];

export async function GET(request: Request) {
  const entityId = new URL(request.url).searchParams.get("entityId") || "";
  if (!entityId) return NextResponse.json({ error: "Missing entityId" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  // RLS ensures the caller can only resolve entities they're allowed to see.
  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, ticker, cik, data_tier").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  // Serve from cache if fresh.
  const { data: existing } = await supabase.from("entity_facts")
    .select("fact_key, value, period, source_url, fetched_at").eq("entity_id", entityId).eq("source", "sec")
    .order("fetched_at", { ascending: false });
  if (existing && existing.length && Date.now() - new Date(existing[0].fetched_at).getTime() < FRESH_MS) {
    return NextResponse.json({
      company: ent.canonical_name, period: existing[0].period, source_url: existing[0].source_url,
      fetched_at: existing[0].fetched_at, cached: true,
      facts: existing.map((f) => ({ key: f.fact_key, value: Number(f.value) })),
    });
  }

  if (!ent.cik && !ent.ticker) {
    return NextResponse.json({ error: "No SEC identifier for this account (Tier D — profile flow coming soon)." }, { status: 422 });
  }

  let fin: Financials | null = null;
  try {
    fin = ent.cik ? await fetchFinancials({ cik: ent.cik, title: ent.canonical_name }) : await fetchFinancials(ent.ticker as string);
  } catch { /* handled below */ }
  if (!fin) return NextResponse.json({ error: "Couldn't pull SEC data for this account." }, { status: 502 });

  const cik = fin.cik || ent.cik;
  const sourceUrl = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=10-K&count=10`;
  const rows = METRICS
    .filter((k) => fin![k] != null)
    .map((k) => ({ entity_id: entityId, source: "sec", fact_key: k as string, period: fin!.period, value: fin![k] as number, unit: "USD_millions", source_url: sourceUrl }));

  // Refresh the cache (service role — shared entities are unwritable under tenant RLS).
  const admin = createAdminClient();
  await admin.from("entity_facts").delete().eq("entity_id", entityId).eq("source", "sec");
  if (rows.length) await admin.from("entity_facts").insert(rows);

  return NextResponse.json({
    company: fin.company, period: fin.period, source_url: sourceUrl, cached: false,
    facts: rows.map((r) => ({ key: r.fact_key, value: r.value })),
  });
}
