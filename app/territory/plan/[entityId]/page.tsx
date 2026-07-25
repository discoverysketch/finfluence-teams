import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ensureEntityFacts, type FactMap } from "@/lib/facts";
import { rankPeers } from "@/lib/lookalike";
import { buildTree } from "@/lib/orgchart";
import { conceptScores, type Ev } from "@/lib/acumen";
import { researchedOn } from "@/lib/researchedAt";
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
    .select("id, canonical_name, ticker, data_tier, hq_state, entity_type, profile_json, priorities_json, priorities_at, decision_locus, decision_note, decision_source, decision_at, hiring_json, comp_json, fleet_json, muni_json, stack_json, hiring_at, comp_at, fleet_at, muni_at, stack_at, employees")
    .eq("id", entityId).maybeSingle();
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

  // key people from the CRM (account for this entity in the caller's tenant)
  const { data: acct } = await supabase.from("accounts").select("id").eq("entity_id", entityId).limit(1).maybeSingle();
  const { data: people } = acct
    ? await supabase.from("contacts").select("id, name, title, role_tag, reports_to, persona_json, persona_at").eq("account_id", acct.id).order("created_at").limit(12)
    : { data: [] };
  const ROLE_LABEL: Record<string, [string, string]> = {
    economic_buyer: ["Economic buyer", "#9A6700"], champion: ["Champion", "#1B7A47"], exec_sponsor: ["Exec sponsor", "#6A3E8E"],
    influencer: ["Influencer", "#0572CE"], end_user: ["User", "#8A7E6E"], blocker: ["Blocker", "#B23A2E"],
  };

  // rep's weakest concepts
  const { data: ev } = await supabase.from("score_events").select("concept_tag, correct").eq("user_id", user.id);
  const weak = conceptScores((ev ?? []) as Ev[]).filter((c) => c.score != null).sort((a, b) => (a.score! - b.score!)).slice(0, 2);

  const pj: any = (ent as any).profile_json;
  const dateStr = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };

  // Everything gathered by research/search, rendered inline so the printed plan
  // carries the homework — each claim keeps its source link.
  const prio: any = (ent as any).priorities_json;
  const hiring: any = (ent as any).hiring_json;
  const comp: any = (ent as any).comp_json;
  const fleet: any = (ent as any).fleet_json;
  const muni: any = (ent as any).muni_json;
  const stack: any = (ent as any).stack_json;
  const locus: string | null = (ent as any).decision_locus ?? null;
  const LOCUS: Record<string, [string, string]> = {
    local: ["Decisions are made locally", "#1B7A47"],
    corporate: ["Decisions run through the parent", "#B23A2E"],
    mixed: ["Split — local input, corporate approval", "#9A6700"],
  };
  const FUEL_COLOR: Record<string, string> = {
    Nuclear: "#6A3E8E", Coal: "#5B5245", Gas: "#0572CE", Oil: "#8A7E6E", Hydro: "#006B72",
    Wind: "#1B7A47", Solar: "#C8902E", Geothermal: "#9A6700", Biomass: "#7A8B4A", Storage: "#B23A2E", Other: "#A9A294",
  };
  // A printed plan gets read days later — every researched block states when it
  // was pulled, so nobody quotes year-old intel in a meeting believing it's live.
  const When = ({ iso }: { iso?: string | null }) => {
    const on = researchedOn(iso);
    return <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 600 }}>{on ? `researched ${on}` : "research date unknown"}</span>;
  };
  const Src = ({ url }: { url?: string | null }) =>
    url && /^https?:\/\//.test(url)
      ? <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 10.5, color: "var(--blue)", fontWeight: 700 }}>source ↗</a>
      : null;

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
            {(() => {
              // 5-year rate-base trend (print-safe inline SVG, like the price sparkline).
              const hist = Object.keys(f).filter((k) => /^net_utility_plant_\d{4}$/.test(k))
                .map((k) => ({ y: k.slice(-4), v: f[k] })).sort((a, b) => a.y.localeCompare(b.y));
              if (hist.length < 3) return null;
              const cagr = (Math.pow(hist[hist.length - 1].v / hist[0].v, 1 / (hist.length - 1)) - 1) * 100;
              const W = 640, H = 64, P = 6;
              const vals = hist.map((h) => h.v);
              const min = Math.min(...vals), max = Math.max(...vals);
              const x = (i: number) => P + (i / (hist.length - 1)) * (W - 2 * P);
              const y = (v: number) => (max === min ? H / 2 : P + (1 - (v - min) / (max - min)) * (H - 2 * P));
              const d = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(h.v).toFixed(1)}`).join(" ");
              return (
                <div style={{ marginTop: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--ink2)" }}>Rate-base trend {hist[0].y}–{hist[hist.length - 1].y} · {fmtM(hist[0].v)} → {fmtM(hist[hist.length - 1].v)}</span>
                    <span style={{ fontSize: 12, fontWeight: 800, color: cagr >= 0 ? "#1B7A47" : "var(--red)" }}>{cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}%/yr</span>
                  </div>
                  <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }} role="img" aria-label="5-year rate-base trend">
                    <path d={d} fill="none" stroke="#006B72" strokeWidth={2.5} />
                    {hist.map((h, i) => <circle key={h.y} cx={x(i)} cy={y(h.v)} r={3} fill="#006B72" />)}
                  </svg>
                </div>
              );
            })()}
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

      {/* ---- Researched intel: everything the app gathered from public sources ---- */}

      {/* Where decisions get made */}
      {locus && (
        <>
          <h2 style={{ fontSize: 15 }}>Where decisions get made</h2>
          <div style={{ border: "1px solid #F0EAE0", borderRadius: 9, padding: "9px 12px", marginBottom: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
              {LOCUS[locus]?.[0] ?? locus}{" "}
              <span style={{ fontSize: 11, fontWeight: 700, color: "#fff", background: LOCUS[locus]?.[1] ?? "#8A7E6E", borderRadius: 5, padding: "1px 7px" }}>{locus}</span>
            </div>
            {ent.decision_note && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.5 }}>{ent.decision_note}</div>}
            <Src url={ent.decision_source} /> <When iso={(ent as any).decision_at} />
          </div>
        </>
      )}

      {/* What leadership is saying — their own words, with citations */}
      {prio?.priorities?.length > 0 && (
        <>
          <h2 style={{ fontSize: 15 }}>What leadership is saying{prio.as_of ? <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}> · {prio.as_of}</span> : null}</h2>
          <div style={{ marginTop: -4, marginBottom: 6 }}><When iso={(ent as any).priorities_at} /></div>
          {prio.summary && <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 8px", lineHeight: 1.5 }}>{prio.summary}</p>}
          {prio.priorities.slice(0, 6).map((p: any, i: number) => (
            <div key={i} className="pblock" style={{ borderLeft: "3px solid #006B72", paddingLeft: 10, marginBottom: 9 }}>
              <div style={{ fontSize: 13, fontWeight: 700 }}>{p.theme}</div>
              {p.detail && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45 }}>{p.detail}</div>}
              {p.quote && <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--ink)", margin: "3px 0" }}>&ldquo;{p.quote}&rdquo;{p.who ? <span style={{ fontStyle: "normal", color: "var(--muted)" }}> — {p.who}</span> : null}</div>}
              {p.angle && <div style={{ fontSize: 12, color: "#006B72" }}><b>Our angle:</b> {p.angle}</div>}
              <Src url={p.source} />
            </div>
          ))}
        </>
      )}

      {/* Deep intel */}
      {(comp || hiring || fleet || muni || stack) && (
        <>
          <h2 style={{ fontSize: 15 }}>Deep intel</h2>

          {!!(stack?.systems?.length || stack?.summary) && (
            <div className="pblock" style={{ marginBottom: 10 }}>
              <div className="plabel">🥊 What they run today{stack.incumbent && stack.incumbent !== "unclear" ? ` · ${stack.incumbent}` : ""}</div>
              {stack.summary && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45, marginBottom: 4 }}>{stack.summary}</div>}
              {(stack.systems ?? []).map((sy: any, i: number) => (
                <div key={i} style={{ padding: "3px 0", borderTop: i ? "1px solid #F7F2E9" : "none" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{sy.vendor}{sy.product ? ` ${sy.product}` : ""}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}> · {sy.area} · {sy.confidence} confidence</span>
                  <div style={{ fontSize: 12, color: "var(--ink2)" }}>{sy.evidence} <Src url={sy.source} /></div>
                </div>
              ))}
              {(stack.angles ?? []).length > 0 && (
                <div style={{ marginTop: 5, borderTop: "1px solid #F0EAE0", paddingTop: 4 }}>
                  {stack.angles.map((a: any, i: number) => (
                    <div key={i} style={{ fontSize: 12, marginBottom: 2 }}><b style={{ color: "#B23A2E" }}>{a.headline}</b> — {a.detail}</div>
                  ))}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>Inferred from public tells — confirm before quoting to a customer. <When iso={(ent as any).stack_at} /></div>
            </div>
          )}

          {!!(comp?.summary || comp?.metrics?.length) && (
            <div className="pblock" style={{ marginBottom: 10 }}>
              <div className="plabel">🎯 What leadership is paid to hit</div>
              {comp.summary && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45, marginBottom: 4 }}>{comp.summary}</div>}
              {(comp.metrics ?? []).slice(0, 6).map((m: any, i: number) => (
                <div key={i} style={{ padding: "3px 0", borderTop: i ? "1px solid #F7F2E9" : "none" }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700 }}>{m.metric}</span>
                  {m.detail && <span style={{ fontSize: 12.5, color: "var(--ink2)" }}> — {m.detail}</span>}
                  {m.angle && <div style={{ fontSize: 12, color: "#006B72" }}><b>Angle:</b> {m.angle}</div>}
                </div>
              ))}
              {ent.employees ? <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>~{Number(ent.employees).toLocaleString()} employees</div> : null}
              <Src url={comp.source} /> <When iso={(ent as any).comp_at} />
            </div>
          )}

          {!!(hiring?.summary || hiring?.roles?.length) && (
            <div className="pblock" style={{ marginBottom: 10 }}>
              <div className="plabel">
                🧑‍💼 Hiring signals
                {hiring.signal && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#fff", borderRadius: 4, padding: "1px 6px", background: hiring.signal === "hot" ? "#B23A2E" : hiring.signal === "warm" ? "#C8902E" : "#8A7E6E" }}>{String(hiring.signal).toUpperCase()}</span>}
              </div>
              {hiring.summary && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45, marginBottom: 4 }}>{hiring.summary}</div>}
              {(hiring.roles ?? []).slice(0, 6).map((r: any, i: number) => (
                <div key={i} style={{ fontSize: 12.5, padding: "2px 0 2px 12px", textIndent: -12 }}>
                  · <b>{r.title}</b>{r.why ? ` — ${r.why}` : ""} <Src url={r.source} />
                </div>
              ))}
              <When iso={(ent as any).hiring_at} />
            </div>
          )}

          {fleet?.total_mw != null && (
            <div className="pblock" style={{ marginBottom: 10 }}>
              <div className="plabel">⚡ Generation fleet</div>
              {fleet.total_mw > 0 && <div style={{ fontSize: 13, fontWeight: 700 }}>≈ {Number(fleet.total_mw).toLocaleString()} MW capacity</div>}
              {fleet.mix?.length > 0 && (
                <>
                  <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", margin: "4px 0 3px" }}>
                    {fleet.mix.slice(0, 6).map((x: any) => <div key={x.fuel} style={{ width: `${x.share_pct}%`, background: FUEL_COLOR[x.fuel] ?? "#8A7E6E" }} />)}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{fleet.mix.map((x: any) => `${x.fuel} ${Math.round(x.share_pct)}%`).join(" · ")}</div>
                </>
              )}
              {(fleet.notable ?? []).slice(0, 4).map((n: string, i: number) => (
                <div key={i} style={{ fontSize: 12, padding: "1px 0 1px 12px", textIndent: -12, color: "var(--ink2)" }}>· {n}</div>
              ))}
              <Src url={fleet.source} /> <When iso={(ent as any).fleet_at} />
            </div>
          )}

          {muni && (muni.revenue_musd != null || muni.customers != null) && (
            <div className="pblock" style={{ marginBottom: 10 }}>
              <div className="plabel">🏛️ Muni financial snapshot</div>
              {muni.summary && <div style={{ fontSize: 12.5, color: "var(--ink2)", lineHeight: 1.45, marginBottom: 4 }}>{muni.summary}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
                {muni.revenue_musd != null && <Sig label="revenue" val={fmtM(muni.revenue_musd)} />}
                {muni.debt_musd != null && <Sig label="debt" val={fmtM(muni.debt_musd)} />}
                {muni.customers != null && <Sig label="customers" val={Number(muni.customers).toLocaleString()} />}
                {muni.rating && <Sig label="rating" val={String(muni.rating)} />}
              </div>
              <Src url={muni.source} /> <When iso={(ent as any).muni_at} />
            </div>
          )}
        </>
      )}

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

      {/* Key people — the org chart itself (server-rendered, print-safe) */}
      {(people ?? []).length > 0 && (() => {
        const { kids, roots } = buildTree((people ?? []) as any[]);
        const Node = ({ p }: { p: any }) => {
          const r = p.role_tag ? ROLE_LABEL[p.role_tag] : null;
          const children = kids[p.id] ?? [];
          return (
            <li>
              <div className="ocp-node" style={{ borderTop: `3px solid ${r ? r[1] : "var(--border)"}` }}>
                <div style={{ fontWeight: 700, fontSize: 11.5, lineHeight: 1.2 }}>{p.name}</div>
                <div style={{ fontSize: 9.5, color: "var(--ink2)", marginTop: 1, lineHeight: 1.25 }}>{p.title || "—"}</div>
                {r && <div style={{ fontSize: 8.5, fontWeight: 700, color: r[1], marginTop: 2, textTransform: "uppercase", letterSpacing: ".4px" }}>{r[0]}</div>}
              </div>
              {children.length > 0 && <ul>{children.map((k: any) => <Node key={k.id} p={k} />)}</ul>}
            </li>
          );
        };
        return (
          <>
            <h2 style={{ fontSize: 15 }}>Key people</h2>
            <div style={{ overflowX: "auto", marginBottom: 12 }}>
              <ul className="ocp">{roots.map((r: any) => <Node key={r.id} p={r} />)}</ul>
            </div>

            {/* Researched persona briefs — public background on the people you'll face */}
            {(people ?? []).some((p: any) => p.persona_json) && (
              <div style={{ marginBottom: 12 }}>
                <div className="plabel">🧠 Who they are · researched briefs</div>
                {(people ?? []).filter((p: any) => p.persona_json).map((p: any) => {
                  const x = p.persona_json;
                  return (
                    <div key={p.id} className="pblock" style={{ borderLeft: "3px solid #6A3E8E", paddingLeft: 10, marginBottom: 9 }}>
                      <div style={{ fontSize: 13, fontWeight: 700 }}>
                        {p.name}{p.title ? <span style={{ fontWeight: 600, color: "var(--ink2)" }}> · {p.title}</span> : null}
                        {x.confidence === "low" && <span style={{ marginLeft: 6, fontSize: 9.5, fontWeight: 700, color: "#7A5B12", background: "#F7F2E9", border: "1px solid #E6CF94", borderRadius: 4, padding: "1px 5px" }}>LOW CONFIDENCE</span>}
                      </div>
                      {x.headline && <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{x.headline}</div>}
                      {x.background && <div style={{ fontSize: 12.5, lineHeight: 1.45, marginTop: 2 }}>{x.background}</div>}
                      {(x.priorities ?? []).length > 0 && (
                        <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}><b>Cares about:</b> {x.priorities.slice(0, 4).join(" · ")}</div>
                      )}
                      {x.quote && <div style={{ fontSize: 12.5, fontStyle: "italic", margin: "3px 0" }}>&ldquo;{x.quote}&rdquo;</div>}
                      {x.talk_to_them && <div style={{ fontSize: 12, color: "#6A3E8E" }}><b>How to talk to them:</b> {x.talk_to_them}</div>}
                      <Src url={x.source} /> <When iso={(p as any).persona_at} />
                    </div>
                  );
                })}
              </div>
            )}
            <style>{`
              .ocp,.ocp ul{list-style:none;margin:0;padding:0}
              .ocp{display:flex;flex-wrap:wrap;gap:0 6px;min-width:min-content}
              .ocp ul{display:flex;padding-top:18px;position:relative}
              .ocp ul::before{content:'';position:absolute;top:0;left:50%;width:2px;height:18px;background:#D8CFC0}
              .ocp li{display:flex;flex-direction:column;align-items:center;position:relative;padding:18px 5px 0}
              .ocp li::before,.ocp li::after{content:'';position:absolute;top:0;right:50%;border-top:2px solid #D8CFC0;width:50%;height:18px}
              .ocp li::after{right:auto;left:50%;border-left:2px solid #D8CFC0}
              .ocp li:only-child::before,.ocp li:only-child::after{border-top:0}
              .ocp li:only-child::after{left:50%;border-left:2px solid #D8CFC0}
              .ocp li:first-child::before,.ocp li:last-child::after{border:0 none}
              .ocp li:last-child::before{border-right:2px solid #D8CFC0;border-radius:0 8px 0 0}
              .ocp li:first-child::after{border-radius:8px 0 0 0}
              .ocp>li{padding-top:6px}
              .ocp>li::before,.ocp>li::after{display:none}
              .ocp-node{background:#fff;border:1px solid rgba(224,216,203,.85);border-radius:9px;padding:7px 10px 6px;min-width:104px;max-width:150px;text-align:center}
            `}</style>
          </>
        );
      })()}

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

      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 20 }}>
        Financials from SEC EDGAR; operations from EIA/FERC; researched sections from public web sources, each linked above.
        All public data — verify against the source before relying on it. Educational tool, not investment advice.
      </p>

      <style>{`
        .plabel{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#8A7E6E;margin-bottom:4px}
        .pblock{break-inside:avoid;page-break-inside:avoid}
        @media print{h2{break-after:avoid;page-break-after:avoid}}
      `}</style>
    </main>
  );
}
