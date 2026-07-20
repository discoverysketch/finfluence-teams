import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ensureEntityFacts, type FactMap } from "@/lib/facts";
import { rankPeers } from "@/lib/lookalike";
import { conceptScores, type Ev } from "@/lib/acumen";
import { fetchPrices, type PriceSeries } from "@/lib/stock";
import Plays from "./Plays";

// Print-friendly inline-SVG sparkline (no client JS — renders in Save-as-PDF).
function Sparkline({ s }: { s: PriceSeries }) {
  const W = 640, H = 90, P = 4;
  const vals = s.points.map((p) => p.c);
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i: number) => P + (i / (s.points.length - 1)) * (W - 2 * P);
  const y = (v: number) => (max === min ? H / 2 : P + (1 - (v - min) / (max - min)) * (H - 2 * P));
  const d = s.points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.c).toFixed(1)}`).join(" ");
  const first = s.points[0], chg = first ? ((s.price - first.c) / first.c) * 100 : 0;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)" }}>Share price · 2y</span>
        <span style={{ fontSize: 14, fontWeight: 800 }}>
          ${s.price.toFixed(2)}{" "}
          <span style={{ color: chg >= 0 ? "#1B7A47" : "var(--red)", fontSize: 12 }}>{chg >= 0 ? "+" : ""}{chg.toFixed(0)}% 2y</span>{" "}
          <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>through {s.asOf}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="2-year share price">
        <path d={d} fill="none" stroke="#B23A2E" strokeWidth={2} />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--muted)" }}>
        <span>{first?.d}</span><span>{s.asOf}</span>
      </div>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const fmtM = (v?: number) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.round(Math.abs(v)) + "M"}`);
const pctOf = (a?: number, b?: number) => (a == null || !b ? "—" : `${Math.round((a / b) * 100)}%`);

export default async function PlanPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, ticker, data_tier, hq_state, entity_type, profile_json").eq("id", entityId).maybeSingle();
  if (!ent) return <main className="container"><p>Account not found.</p><Link href="/territory">← Accounts</Link></main>;

  const target = await ensureEntityFacts(supabase, entityId);
  const facts: FactMap = target.ok ? target.facts : {};
  const period = target.ok ? target.period : null;
  const prices = ent.ticker ? await fetchPrices(ent.ticker) : null;

  // closest peer (needs financials)
  let peer: { name: string; ticker: string | null; facts: FactMap; similarity: number } | null = null;
  if (target.ok) {
    const { data: fr } = await supabase.from("entity_facts").select("entity_id, fact_key, value, period").eq("source", "sec");
    const byE: Record<string, FactMap> = {};
    for (const r of (fr ?? []) as any[]) { if (r.entity_id === entityId) continue; (byE[r.entity_id] ??= {})[r.fact_key] = Number(r.value); }
    const ids = Object.keys(byE).filter((id) => Object.keys(byE[id]).length >= 3);
    if (ids.length) {
      const { data: ents } = await supabase.from("entities").select("id, canonical_name, ticker").in("id", ids);
      const meta: Record<string, any> = {}; for (const e of (ents ?? []) as any[]) meta[e.id] = e;
      const ranked = rankPeers(facts, ids.filter((id) => meta[id]).map((id) => ({ id, facts: byE[id], name: meta[id].canonical_name, ticker: meta[id].ticker })));
      if (ranked[0]) peer = { name: (ranked[0] as any).name, ticker: (ranked[0] as any).ticker, facts: ranked[0].facts, similarity: Math.round(ranked[0].similarity * 100) };
    }
  }

  // rep's weakest concepts
  const { data: ev } = await supabase.from("score_events").select("concept_tag, correct").eq("user_id", user.id);
  const weak = conceptScores((ev ?? []) as Ev[]).filter((c) => c.score != null).sort((a, b) => (a.score! - b.score!)).slice(0, 2);

  const pj: any = (ent as any).profile_json;
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };

  const Sig = ({ label, val }: { label: string; val: string }) => (
    <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: "8px 10px", textAlign: "center" }}>
      <div style={{ fontSize: 16, fontWeight: 800 }}>{val}</div>
      <div style={{ fontSize: 10.5, color: "var(--ink2)" }}>{label}</div>
    </div>
  );

  return (
    <main className="container" style={{ maxWidth: 720, paddingBottom: 60 }}>
      <div className="noprint" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "8px 0 14px" }}>
        <Link href="/territory" style={{ fontSize: 13 }}>← Accounts</Link>
      </div>

      <div style={{ borderBottom: "3px solid var(--red)", paddingBottom: 10, marginBottom: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".8px", color: "var(--muted)" }}>Account Plan</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <h1 style={{ margin: "2px 0" }}>{ent.canonical_name}</h1>
          {ent.ticker && <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--muted)", fontWeight: 700 }}>{ent.ticker}</span>}
          {ent.data_tier && <span style={{ background: TIER_COLOR[ent.data_tier] || "#8A7E6E", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 8px" }}>Tier {ent.data_tier}</span>}
        </div>
        <div style={{ fontSize: 12, color: "var(--ink2)" }}>{ent.hq_state ? ent.hq_state + " · " : ""}Prepared {dateStr}</div>
      </div>

      {/* Snapshot */}
      <h2 style={{ fontSize: 15 }}>Snapshot</h2>
      {prices && prices.points.length > 1 && <Sparkline s={prices} />}
      {target.ok && target.eia && (() => {
        const e = target.eia.facts;
        const mixTotal = (e.res_revenue || 0) + (e.com_revenue || 0) + (e.ind_revenue || 0);
        const mix: [string, number, string][] = mixTotal > 0 ? [
          ["Residential", (e.res_revenue || 0) / mixTotal, "#C8902E"],
          ["Commercial", (e.com_revenue || 0) / mixTotal, "#0572CE"],
          ["Industrial", (e.ind_revenue || 0) / mixTotal, "#006B72"],
        ] : [];
        const cell = (n: string, l: string) => (
          <div key={l} style={{ border: "1px solid #F0EAE0", borderRadius: 8, padding: "7px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{n}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
          </div>
        );
        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 5 }}>
              ⚡ Utility operations · EIA-861 {target.eia.period}{(e.utilities_count ?? 0) > 1 ? ` · across ${e.utilities_count} utilities` : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {e.customers != null && cell(e.customers >= 1e6 ? `${(e.customers / 1e6).toFixed(2)}M` : `${Math.round(e.customers / 1e3)}k`, "customers")}
              {e.sales_mwh != null && cell(e.sales_mwh >= 1e6 ? `${(e.sales_mwh / 1e6).toFixed(1)} TWh` : `${Math.round(e.sales_mwh / 1e3)} GWh`, "energy delivered")}
              {e.revenue != null && cell(fmtM(e.revenue), "retail revenue")}
              {e.customers && e.revenue ? cell(`$${Math.round((e.revenue * 1e6) / e.customers).toLocaleString()}`, "rev / customer") : null}
            </div>
            {mix.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden" }}>
                  {mix.map(([l, p, c]) => <div key={l} style={{ width: `${p * 100}%`, background: c }} />)}
                </div>
                <div style={{ fontSize: 10.5, color: "var(--ink2)", marginTop: 3 }}>
                  Revenue mix: {mix.map(([l, p]) => `${l} ${Math.round(p * 100)}%`).join(" · ")}
                </div>
              </div>
            )}
          </div>
        );
      })()}
      {target.ok && target.ferc && (() => {
        const f = target.ferc.facts;
        const cell = (n: string, l: string) => (
          <div key={l} style={{ border: "1px solid #F0EAE0", borderRadius: 8, padding: "7px 10px", textAlign: "center" }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{fmtM(Number(n))}</div>
            <div style={{ fontSize: 10.5, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
          </div>
        );
        return (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 5 }}>
              🏛️ Regulated financials · FERC Form 1 {target.ferc.period}{(f.respondents_count ?? 0) > 1 ? ` · across ${f.respondents_count} respondents` : ""}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
              {f.net_utility_plant != null && cell(String(f.net_utility_plant), "net utility plant")}
              {f.cwip != null && cell(String(f.cwip), "CWIP")}
              {f.om_expense != null && cell(String(f.om_expense), "electric O&M")}
              {f.electric_revenue != null && cell(String(f.electric_revenue), "electric revenue")}
            </div>
          </div>
        );
      })()}
      {target.ok && Object.keys(facts).length > 0 ? (
        <>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>{period} · $ millions</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px", marginBottom: 12 }}>
            {([["Revenue", facts.revenue], ["Net income", facts.netIncome], ["Total assets", facts.totalAssets], ["Total debt", facts.totalDebt], ["Op. cash flow", facts.operatingCashFlow], ["Capex", facts.capex]] as [string, number | undefined][]).map(([l, v]) => (
              <div key={l} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
                <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{l}</span>
                <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtM(v)}</span>
              </div>
            ))}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginBottom: 4 }}>
            <Sig label="Leverage (D/A)" val={pctOf(facts.totalDebt, facts.totalAssets)} />
            <Sig label="Capex/rev" val={facts.capex != null && facts.revenue ? `${Math.round(Math.abs(facts.capex) / facts.revenue * 100)}%` : "—"} />
            <Sig label="Cash margin" val={pctOf(facts.operatingCashFlow, facts.revenue)} />
            <Sig label="ROA" val={pctOf(facts.netIncome, facts.totalAssets)} />
          </div>
        </>
      ) : pj ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 13 }}>
            {pj.ownership && (<><b style={{ color: "var(--ink2)" }}>Ownership</b><span>{pj.ownership}</span></>)}
            {pj.est_size && (<><b style={{ color: "var(--ink2)" }}>Size</b><span>{pj.est_size}</span></>)}
            {pj.segment && (<><b style={{ color: "var(--ink2)" }}>Segment</b><span>{pj.segment}</span></>)}
          </div>
          {pj.summary && <p style={{ fontSize: 13.5, lineHeight: 1.5 }}>{pj.summary}</p>}
          {pj.sources?.length > 0 && <div style={{ fontSize: 12 }}><b>Sources:</b> {pj.sources.map((s: any, i: number) => <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", marginRight: 8 }}>{(s.title || "source").slice(0, 22)} ↗</a>)}</div>}
        </div>
      ) : (target.ok && target.eia) ? null : <p style={{ color: "var(--ink2)" }}>No financial data available for this account.</p>}

      {/* Peer */}
      {peer && (
        <>
          <h2 style={{ fontSize: 15 }}>Closest peer · {peer.name}{peer.ticker ? ` (${peer.ticker})` : ""} <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{peer.similarity}% similar</span></h2>
          <table style={{ borderCollapse: "collapse", fontSize: 13, width: "100%", marginBottom: 12 }}>
            <thead><tr><th style={{ textAlign: "left", padding: "4px 8px", color: "var(--ink2)" }}>Metric</th><th style={{ textAlign: "right", padding: "4px 8px" }}>{ent.ticker || "This account"}</th><th style={{ textAlign: "right", padding: "4px 8px" }}>{peer.ticker || peer.name.slice(0, 10)}</th></tr></thead>
            <tbody>
              {([["Revenue", "revenue"], ["Total debt", "totalDebt"], ["Op. cash flow", "operatingCashFlow"], ["Total assets", "totalAssets"]] as [string, string][]).map(([l, k]) => (
                <tr key={k}><td style={{ padding: "3px 8px", fontWeight: 600, borderTop: "1px solid #F0EAE0" }}>{l}</td><td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", borderTop: "1px solid #F0EAE0" }}>{fmtM(facts[k])}</td><td style={{ padding: "3px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", borderTop: "1px solid #F0EAE0" }}>{fmtM(peer.facts[k])}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Focus areas */}
      {weak.length > 0 && (
        <>
          <h2 style={{ fontSize: 15 }}>Your focus areas before this call</h2>
          <p style={{ fontSize: 13.5, color: "var(--ink2)", marginTop: 0 }}>Concepts where your Acumen is lowest — worth a refresh so you can speak to them with this CFO:</p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {weak.map((c) => <span key={c.key} style={{ background: "#F7F2E9", border: "1px solid #E6CF94", color: "#7A5B12", borderRadius: 6, padding: "5px 11px", fontSize: 13, fontWeight: 700 }}>{c.label} · {c.score}</span>)}
          </div>
        </>
      )}

      {/* Plays (client-generated) */}
      <Plays entityId={entityId} peerName={peer?.name ?? null} peerFacts={peer?.facts ?? null} weakConcepts={weak.map((c) => c.label)} />

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 20 }}>Figures from SEC EDGAR — verify against filings. Educational tool, not investment advice.</p>
    </main>
  );
}
