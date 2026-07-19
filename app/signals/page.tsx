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
  const [{ data: events }, { data: news }, { data: bookEnts }] = await Promise.all([
    entityIds.length
      ? supabase.from("filing_events")
          .select("id, form, filed, items, label, entity:entities(id, canonical_name, ticker)")
          .in("entity_id", entityIds).gte("filed", since)
          .order("filed", { ascending: false }).limit(50)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from("news_items").select("*").order("created_at", { ascending: false }).limit(20),
    entityIds.length ? supabase.from("entities").select("canonical_name, ticker").in("id", entityIds) : Promise.resolve({ data: [] as any[] }),
  ]);

  // Highlight industry stories that mention one of the book's accounts.
  const bookNames = ((bookEnts ?? []) as any[]).flatMap((e) => {
    const words = String(e.canonical_name).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3 && !["corp", "corporation", "company", "energy", "inc", "group", "holdings"].includes(w));
    return [...(e.ticker ? [String(e.ticker).toLowerCase()] : []), words.slice(0, 2).join(" ")].filter((s) => s.length > 3);
  });
  const mentionsBook = (n: any) => {
    const hay = `${n.headline} ${n.companies || ""}`.toLowerCase();
    return bookNames.some((b) => hay.includes(b));
  };

  const CAT: Record<string, { label: string; icon: string; color: string }> = {
    capital_projects: { label: "Capital projects", icon: "🏗️", color: "#9A6700" },
    data_centers: { label: "Data centers", icon: "🖥️", color: "#6A3E8E" },
    regulatory: { label: "Regulatory", icon: "🏛️", color: "#0572CE" },
    rates: { label: "Rate case", icon: "⚖️", color: "#006B72" },
    ma: { label: "M&A", icon: "🤝", color: "#B23A2E" },
    grid: { label: "Grid", icon: "⚡", color: "#1B7A47" },
    other: { label: "Industry", icon: "📰", color: "#8A7E6E" },
  };

  return (
    <Shell active="home" isAdmin={isAdmin}>
      <h1>Signal <span style={{ color: "var(--red)" }}>feed</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        What's happening at your accounts — earnings, executive changes, deals, and financings from SEC filings, checked daily.
      </p>

      <div className="sigttl">📁 Your accounts</div>
      {(events ?? []).length === 0 && (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13.5 }}>
          Nothing in the last 60 days from your accounts. The watcher checks daily — enable notifications on the <Link href="/">Me page</Link> to get pinged when something lands.
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

      <div className="sigttl" style={{ marginTop: 26 }}>🏭 Across the industry</div>
      {(news ?? []).length === 0 && (
        <div className="card" style={{ fontSize: 13, color: "var(--ink2)" }}>
          The industry sweep runs daily — capital projects, data-center deals, regulatory moves. First items appear after the next run.
        </div>
      )}
      {(news ?? []).map((n: any) => {
        const cat = CAT[n.category] ?? CAT.other;
        const hot = mentionsBook(n);
        let domain = "";
        try { domain = new URL(n.source_url).hostname.replace(/^www\./, ""); } catch { /* keep empty */ }
        return (
          <div key={n.id} className="card" style={{ display: "flex", gap: 12, marginBottom: 8, padding: "13px 14px", outline: hot ? "2px solid var(--gold)" : "none" }}>
            <div style={{ fontSize: 20, lineHeight: 1 }}>{cat.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <a href={n.source_url} target="_blank" rel="noreferrer" style={{ fontWeight: 700, fontSize: 14, color: "inherit" }}>{n.headline}</a>
              <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>{n.summary}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 7, flexWrap: "wrap" }}>
                <span style={{ background: cat.color, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px" }}>{cat.label}</span>
                {hot && <span style={{ background: "var(--gold)", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px" }}>★ mentions your account</span>}
                {n.published && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{fmtDay(n.published)}</span>}
                {domain && <span style={{ fontSize: 11, color: "var(--muted)" }}>{domain}</span>}
              </div>
            </div>
          </div>
        );
      })}

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 12 }}>
        Sources: SEC EDGAR filings + daily web sweep of trade press & official releases · verify before acting.
      </p>
      <style>{`.sigttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:18px 0 8px}`}</style>
    </Shell>
  );
}
