import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { PARTNERS, findEvidence, assessFit, FIT_COLOR, type Evidence, type Fit } from "@/lib/partners";
import type { FactMap } from "@/lib/facts";

// Partner desk: where a partner already shows up in the book, where the product
// line sits, and which accounts look like joint targets on public financials.
// No AI anywhere on this page — evidence comes from research already paid for,
// and fit is computed from FERC Form 1.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  const wanted = (await searchParams).p;
  const partner = PARTNERS.find((x) => x.key === wanted) ?? PARTNERS[0];

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, entity:entities(id, canonical_name, ticker, hq_state, hiring_json, stack_json, priorities_json, risks_json, profile_json)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");

  const rows = ((accts ?? []) as any[]).filter((a) => a.entity);
  const ids = rows.map((a) => a.entity.id);

  // FERC Form 1 for every account in one query — the fit score needs nothing else.
  const factsOf: Record<string, FactMap> = {};
  if (ids.length) {
    const { data: facts } = await supabase.from("entity_facts")
      .select("entity_id, fact_key, value").eq("source", "ferc").in("entity_id", ids);
    for (const f of (facts ?? []) as any[]) {
      (factsOf[f.entity_id] ||= {})[f.fact_key] = Number(f.value);
    }
  }

  type Row = { accountId: string; name: string; ticker: string | null; evidence: Evidence[]; fit: Fit | null };
  const all: Row[] = rows.map((a) => {
    const e = a.entity;
    return {
      accountId: a.id, name: e.canonical_name, ticker: e.ticker ?? null,
      evidence: findEvidence(
        { hiring_json: e.hiring_json, stack_json: e.stack_json, priorities_json: e.priorities_json, risks_json: e.risks_json, profile_json: e.profile_json },
        partner.match,
      ),
      fit: assessFit(factsOf[e.id] ?? null),
    };
  });

  const RANK: Record<string, number> = { strong: 0, good: 1, possible: 2, thin: 3 };
  const present = all.filter((r) => r.evidence.length).sort((a, b) => (RANK[a.fit?.band ?? "thin"] ?? 3) - (RANK[b.fit?.band ?? "thin"] ?? 3));
  const targets = all.filter((r) => !r.evidence.length && r.fit && (r.fit.band === "strong" || r.fit.band === "good"))
    .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0));

  const Badge = ({ fit }: { fit: Fit | null }) => !fit ? null : (
    <span style={{ background: FIT_COLOR[fit.band], color: "#fff", fontSize: 9.5, fontWeight: 800, letterSpacing: ".3px", textTransform: "uppercase", borderRadius: 4, padding: "2px 7px", flexShrink: 0 }}>
      {fit.label}
    </span>
  );

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
      <h1>Partner <span style={{ color: "var(--red)" }}>desk</span></h1>

      {PARTNERS.length > 1 && (
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap", margin: "0 0 10px" }}>
          {PARTNERS.map((p) => (
            <Link key={p.key} href={`/partners?p=${p.key}`} className="ptab"
              style={{ background: p.key === partner.key ? "var(--cream2)" : "#fff" }}>{p.name}</Link>
          ))}
        </div>
      )}

      <div className="card" style={{ padding: "13px 14px", marginBottom: 14 }}>
        <div style={{ fontSize: 17, fontWeight: 800 }}>{partner.name}</div>
        <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 2 }}>{partner.tagline}</div>
        <div style={{ fontSize: 12.5, lineHeight: 1.5, marginTop: 8, background: "#EEF7F1", borderLeft: "3px solid #1B7A47", borderRadius: 6, padding: "8px 10px" }}>
          {partner.boundary.together}
        </div>
      </div>

      {/* ---------- 1. Where they already are ---------- */}
      <div className="ptt">🤝 Already in your book · {present.length}</div>
      {!present.length ? (
        <div className="card" style={{ fontSize: 13, color: "var(--ink2)" }}>
          No {partner.name} evidence in the research so far. It is picked up automatically from job postings and stack research as accounts are researched.
        </div>
      ) : present.map((r) => (
        <div key={r.accountId} className="card" style={{ padding: "12px 14px", marginBottom: 8 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
            <Link href={`/territory/account/${r.accountId}`} style={{ fontSize: 14.5, fontWeight: 800, color: "var(--ink)" }}>{r.name}</Link>
            {r.ticker && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{r.ticker}</span>}
            <Badge fit={r.fit} />
          </div>
          {r.evidence.map((e, i) => (
            <div key={i} style={{ marginTop: 7, borderLeft: "3px solid var(--gold)", background: "#F7F2E9", borderRadius: 6, padding: "7px 10px" }}>
              <div style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>{e.field}</div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>{e.quote}</div>
              {e.source && <a href={e.source} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--blue)", fontWeight: 700 }}>source ↗</a>}
            </div>
          ))}
        </div>
      ))}

      {/* ---------- 2. Where the line sits ---------- */}
      <div className="ptt">📐 Where the line sits</div>
      <div className="card" style={{ padding: "13px 14px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "var(--red)", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>Oracle</div>
            {partner.boundary.oracle.map((x, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.4, padding: "2px 0 2px 12px", textIndent: -12 }}>· {x}</div>)}
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 800, color: "#1B7A47", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 5 }}>{partner.name}</div>
            {partner.boundary.partner.map((x, i) => <div key={i} style={{ fontSize: 12.5, lineHeight: 1.4, padding: "2px 0 2px 12px", textIndent: -12 }}>· {x}</div>)}
          </div>
        </div>
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 10, lineHeight: 1.45 }}>
          Taken from {partner.name}&apos;s own public descriptions — {partner.sources.map((s, i) => (
            <span key={s.url}>{i ? " · " : ""}<a href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>{s.title} ↗</a></span>
          ))}
        </div>
      </div>

      {/* ---------- 3. Joint targets ---------- */}
      <div className="ptt">🎯 Joint targets · {targets.length}</div>
      {!targets.length ? (
        <div className="card" style={{ fontSize: 13, color: "var(--ink2)" }}>
          No accounts scored yet — fit is computed from FERC Form 1, so it needs <code>npm run load-ferc</code> to have run for these accounts.
        </div>
      ) : (
        <>
          <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: "0 0 8px" }}>
            Accounts with no {partner.name} evidence yet, ranked by how much asset accounting their public financials imply. {partner.fitBasis}
          </p>
          {targets.map((r) => (
            <div key={r.accountId} className="card" style={{ padding: "11px 14px", marginBottom: 7 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <Link href={`/territory/account/${r.accountId}`} style={{ fontSize: 14, fontWeight: 800, color: "var(--ink)" }}>{r.name}</Link>
                {r.ticker && <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "var(--muted)", fontWeight: 700 }}>{r.ticker}</span>}
                <Badge fit={r.fit} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "3px 14px", marginTop: 5 }}>
                {r.fit?.drivers.map((d, i) => (
                  <span key={i} style={{ fontSize: 11.5, color: "var(--ink2)" }}>
                    <b style={{ color: "var(--muted)", fontWeight: 700 }}>{d.label}:</b> {d.value}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </>
      )}

      <div style={{ fontSize: 10.5, color: "var(--muted)", margin: "14px 0 4px", lineHeight: 1.45 }}>
        Fit is a signal computed from public FERC Form 1 filings — the size of the asset base, construction in progress and rate-base growth.
        It says how much asset accounting an account has to do, not that anyone intends to buy anything.
      </div>

      <style>{`
        .ptt{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:18px 0 8px}
        .ptab{border:1px solid var(--border);border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;color:var(--ink2);text-decoration:none}
        @media (max-width:430px){ .card > div[style*="grid-template-columns"]{grid-template-columns:1fr !important} }
      `}</style>
    </Shell>
  );
}
