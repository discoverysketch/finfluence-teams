import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { classifyFiling, SUGGESTED_MOVE } from "@/lib/signalTypes";

// Buying-signal feed (SPEC 7c): classified SEC events for the accounts in the
// book — earnings, exec changes, M&A, financings — each with a suggested move.
/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtDay = (s: string) => new Date(s + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });

export default async function SignalsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, entity_id").eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
  const acctOf: Record<string, string> = {};
  for (const a of (accts ?? []) as any[]) if (a.entity_id) acctOf[a.entity_id] = a.id;
  const entityIds = Object.keys(acctOf);

  const since = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: events } = entityIds.length
    ? await supabase.from("filing_events")
        .select("id, form, filed, items, label, entity:entities(id, canonical_name, ticker)")
        .in("entity_id", entityIds).gte("filed", since)
        .order("filed", { ascending: false }).limit(50)
    : { data: [] };

  return (
    <Shell active="home" isAdmin={isAdmin}>
      <h1>Signal <span style={{ color: "var(--red)" }}>feed</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        What's happening at your accounts — earnings, executive changes, deals, and financings from SEC filings, checked daily.
      </p>

      {(events ?? []).length === 0 && (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13.5 }}>
          Nothing in the last 60 days from your accounts. The watcher checks every day — enable notifications on the <Link href="/">Me page</Link> to get pinged the moment something lands.
        </div>
      )}

      {(events ?? []).map((ev: any) => {
        const sig = classifyFiling(ev.form, ev.items) ?? { kind: "earnings" as const, label: ev.label || `${ev.form} filed`, icon: "📄" };
        const isEarnings = sig.kind === "earnings";
        const hubId = acctOf[ev.entity.id];
        return (
          <div key={ev.id} className="card" style={{ display: "flex", gap: 12, marginBottom: 8, padding: "13px 14px" }}>
            <div style={{ fontSize: 22, lineHeight: 1 }}>{sig.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                <span style={{ fontWeight: 700, fontSize: 14 }}>{ev.entity.canonical_name}{ev.entity.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {ev.entity.ticker}</span> : null}</span>
                <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, flexShrink: 0 }}>{fmtDay(ev.filed)}</span>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 1 }}>{ev.label || sig.label}</div>
              <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>{SUGGESTED_MOVE[sig.kind]}</div>
              <div style={{ display: "flex", gap: 10, marginTop: 7 }}>
                {isEarnings && (
                  <Link href={`/challenge/pulse?entity=${ev.entity.id}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--red)" }}>Take the pulse →</Link>
                )}
                {hubId && <Link href={`/territory/account/${hubId}`} style={{ fontSize: 12.5, fontWeight: 700, color: "var(--blue)" }}>Open account →</Link>}
              </div>
            </div>
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 12 }}>
        Source: SEC EDGAR filings (10-K, 10-Q, classified 8-K events) · verify against the filing before acting.
      </p>
    </Shell>
  );
}
