import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { ensureEntityFacts } from "@/lib/facts";
import { buildQuiz, type Fin } from "@/lib/challenge";
import Pulse from "./Pulse";

// Earnings Pulse (SPEC 6b): a 5-question round on an account's freshest numbers,
// reached from a push notification or the recent-filings list below.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function PulsePage({ searchParams }: { searchParams: Promise<{ entity?: string }> }) {
  const { entity: entityId } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  // With an entity: build the pulse round from its (fresh) facts.
  if (entityId) {
    const res = await ensureEntityFacts(supabase, entityId);
    if (res.ok) {
      const fin: Fin = { company: res.company, period: res.period } as Fin;
      for (const [k, v] of Object.entries(res.facts)) if (!k.startsWith("fy_")) (fin as any)[k] = v;
      const qs = buildQuiz(fin);
      if (qs.length >= 3) {
        return (
          <Shell active="challenge" isAdmin={isAdmin}>
            <p style={{ fontSize: 13 }}><Link href="/challenge/pulse">← Pulse</Link></p>
            <h1>Earnings <span style={{ color: "var(--red)" }}>Pulse</span></h1>
            <Pulse userId={user.id} data={fin} questions={qs} />
          </Shell>
        );
      }
    }
    return (
      <Shell active="challenge" isAdmin={isAdmin}>
        <h1>Earnings <span style={{ color: "var(--red)" }}>Pulse</span></h1>
        <div className="card">Couldn&apos;t build a pulse for that account{res.ok ? " (not enough data)" : ` — ${res.error}`}. <Link href="/challenge/pulse">Back to recent filings</Link>.</div>
      </Shell>
    );
  }

  // No entity: list recent filings among the tenant's accounts.
  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("entity_id").eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
  const entityIds = ((accts ?? []) as any[]).map((a) => a.entity_id).filter(Boolean);
  const { data: filings } = entityIds.length
    ? await supabase.from("filing_events")
        .select("id, form, filed, entity:entities(id, canonical_name, ticker)")
        .in("entity_id", entityIds).order("filed", { ascending: false }).limit(12)
    : { data: [] };

  return (
    <Shell active="challenge" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/challenge">← Challenge</Link></p>
      <h1>Earnings <span style={{ color: "var(--red)" }}>Pulse</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        When one of your accounts files a 10-K or 10-Q, it shows up here (and pings you if notifications are on). Take a quick pulse on the fresh numbers.
      </p>
      {(filings ?? []).length === 0 ? (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13.5 }}>
          No new filings from your accounts in the watch window yet. The watcher checks every 6 hours — enable notifications on the <Link href="/">Me page</Link> to get pinged the moment one lands.
        </div>
      ) : (
        (filings ?? []).map((f: any) => (
          <Link key={f.id} href={`/challenge/pulse?entity=${f.entity.id}`} style={{ color: "inherit" }}>
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <div style={{ fontSize: 22 }}>📊</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{f.entity.canonical_name}{f.entity.ticker ? ` (${f.entity.ticker})` : ""}</div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>Filed a {f.form} on {f.filed}</div>
              </div>
              <div style={{ fontSize: 18 }}>›</div>
            </div>
          </Link>
        ))
      )}
    </Shell>
  );
}
