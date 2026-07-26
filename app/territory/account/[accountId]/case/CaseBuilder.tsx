"use client";
import { Fragment, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Savings levers on the account's REAL figures. All math is deterministic and
// visible; the AI only writes the narrative around numbers it's handed.
type Narr = { headline: string; rationale: string[]; risks: string; cfo_line: string };
type Price = { id: string; family: string; name: string; metric: string; list_price: number; as_of: string | null };
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}B` : `$${v >= 10 ? Math.round(v) : v.toFixed(1)}M`);
const perEmployee = (m: string) => /employee|compensated individual/i.test(m);
// Oracle publishes a metric per SKU — "Hosted Named User/month", "Hosted
// Employee/month", "Hosted 1,000 Records/month". Show it rather than flatten
// everything to "user": the metric is what a customer will argue about.
const unitOf = (m: string) => {
  const t = String(m || "");
  if (/named user/i.test(t)) return "named user";
  if (/compensated individual/i.test(t)) return "comp. individual";
  if (/employee/i.test(t)) return "employee";
  if (/1,?000 records/i.test(t)) return "1k records";
  if (/service customer/i.test(t)) return "svc customer";
  return t.replace(/\/month$/i, "") || "unit";
};

export default function CaseBuilder({ entityId, company }: { entityId: string; company: string }) {
  const supabase = createClient();
  const [base, setBase] = useState<{ om: number | null; capex: number | null; revenue: number | null; rateBase: number | null }>({ om: null, capex: null, revenue: null, rateBase: null });
  const [loading, setLoading] = useState(true);
  // Levers (the rep's assumptions — always shown as assumptions)
  const [omPct, setOmPct] = useState(1.5);
  const [capexPct, setCapexPct] = useState(1.0);
  const [closeDays, setCloseDays] = useState(3);
  const [financeFtes, setFinanceFtes] = useState(25);
  const [investM, setInvestM] = useState<number>(1.5);
  const [narr, setNarr] = useState<Narr | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  // License estimator (public Oracle list price)
  const [prices, setPrices] = useState<Price[]>([]);
  const [showEst, setShowEst] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  // Discount is the rep's own assumption, per SKU, with a default applied to
  // anything not set individually — enterprise agreements rarely discount
  // every line the same way.
  const [disc, setDisc] = useState<Record<string, number>>({});
  const [defaultDisc, setDefaultDisc] = useState<number>(50);
  const [employees, setEmployees] = useState(1500);
  const [users, setUsers] = useState(150);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch(`/api/entity-facts?entityId=${entityId}`);
        const j = await r.json();
        if (r.ok) {
          const f = j.facts ? Object.fromEntries((j.facts as { key: string; value: number }[]).map((x) => [x.key, x.value])) : {};
          setBase({
            om: j.ferc?.facts?.om_expense ?? null,
            capex: f.fy_capex != null ? Math.abs(f.fy_capex) : null,
            revenue: f.fy_revenue ?? null,
            rateBase: j.ferc?.facts?.net_utility_plant ?? null,
          });
          // Rough utility staffing proxy from retail customers (~1 employee per
          // 350 customers) so the employee default isn't a wild guess.
          const cust = j.eia?.facts?.customers;
          if (cust) setEmployees(Math.max(200, Math.round(cust / 350 / 50) * 50));
        }
      } catch { /* levers still work with manual entry */ }
      setLoading(false);
    })();
    (async () => {
      const { data } = await supabase.from("pricing_products").select("id, family, name, metric, list_price, as_of").order("ord");
      setPrices((data ?? []) as Price[]);
    })();
    // Prefer a real researched employee count over the customer proxy.
    (async () => {
      const { data } = await supabase.from("entities").select("employees").eq("id", entityId).maybeSingle();
      if (data?.employees && Number(data.employees) > 0) setEmployees(Number(data.employees));
    })();
  }, [entityId, supabase]);

  // ---- license estimate (public list price × quantities) ----
  // One row per selected SKU so quantities and discounts can differ per line.
  const lines = prices
    .filter((p) => qty[p.id] !== undefined)
    .map((p) => {
      const q = qty[p.id] === -1 ? (perEmployee(p.metric) ? employees : users) : qty[p.id];
      const d = disc[p.id] ?? defaultDisc;
      const listYr = (Number(p.list_price) || 0) * q * 12;
      return { p, q, d, listYr, netYr: listYr * (1 - d / 100) };
    });
  const listAnnual = lines.reduce((n, l) => n + l.listYr, 0) / 1e6;
  const licenseAnnual = lines.reduce((n, l) => n + l.netYr, 0) / 1e6;
  const blendedDisc = listAnnual > 0 ? (1 - licenseAnnual / listAnnual) * 100 : 0;

  const pricedAsOf = prices[0]?.as_of;

  // ---- deterministic model ($M/yr) ----
  const omSave = base.om != null ? (base.om * omPct) / 100 : 0;
  const capexSave = base.capex != null ? (base.capex * capexPct) / 100 : 0;
  const dailyTeamCostM = (financeFtes * 140000) / 240 / 1e6; // loaded $140k/FTE, 240 workdays
  const closeSave = closeDays * 12 * dailyTeamCostM;
  const annual = omSave + capexSave + closeSave;
  const threeYr = annual * 3;

  const roi = investM > 0 ? threeYr / investM : 0;
  const paybackMo = annual > 0 ? (investM / annual) * 12 : 0;

  async function writeCase() {
    setBusy(true); setErr(""); setNarr(null);
    try {
      const r = await fetch("/api/business-case", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityId,
          model: {
            baseline: { electric_om_expense: base.om, fy_capex: base.capex, fy_revenue: base.revenue, rate_base: base.rateBase },
            assumptions: {
              om_efficiency_pct: omPct, capex_program_efficiency_pct: capexPct,
              close_days_saved_per_month: closeDays, finance_team_ftes: financeFtes, loaded_cost_per_fte_usd: 140000,
              indicative_investment: investM,
            },
            computed: {
              om_savings_per_year: Math.round(omSave * 100) / 100,
              capex_efficiency_per_year: Math.round(capexSave * 100) / 100,
              close_acceleration_per_year: Math.round(closeSave * 100) / 100,
              total_annual_benefit: Math.round(annual * 100) / 100,
              three_year_benefit: Math.round(threeYr * 100) / 100,
              roi_3yr_multiple: Math.round(roi * 10) / 10,
              payback_months: Math.round(paybackMo),
            },
          },
        }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.narrative) { setErr(j?.error || "Couldn't write the case."); return; }
      setNarr(j.narrative);
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  const Lever = ({ label, value, set, min, max, step, unit, baseline }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; unit: string; baseline?: string }) => (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 700 }}>
        <span>{label}{baseline ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · base {baseline}</span> : null}</span>
        <span style={{ color: "var(--red)" }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => set(Number(e.target.value))} style={{ width: "100%" }} className="noprint" />
    </div>
  );

  if (loading) return <div style={{ fontSize: 13, color: "var(--ink2)" }}>Pulling {company}&apos;s figures…</div>;

  return (
    <div>
      <div className="card noprint" style={{ padding: "13px 14px", marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 8 }}>Savings levers — your assumptions, their numbers</div>
        {base.om != null && <Lever label="O&M efficiency" baseline={fmtM(base.om)} value={omPct} set={setOmPct} min={0} max={5} step={0.25} unit="%" />}
        {base.capex != null && <Lever label="Capital-program efficiency" baseline={fmtM(base.capex)} value={capexPct} set={setCapexPct} min={0} max={3} step={0.25} unit="%" />}
        <Lever label="Close days saved / month" value={closeDays} set={setCloseDays} min={0} max={10} step={1} unit="d" />
        <Lever label="Finance team size" value={financeFtes} set={setFinanceFtes} min={5} max={200} step={5} unit=" FTEs" />
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Indicative investment ($M)</span>
          <input inputMode="decimal" value={investM} onChange={(e) => setInvestM(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
            style={{ width: 90, fontSize: 13, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border)" }} />
          {prices.length > 0 && <button className="mini" onClick={() => setShowEst((v) => !v)}>{showEst ? "Hide estimate" : "🧮 Estimate from Oracle list price"}</button>}
        </div>

        {showEst && prices.length > 0 && (
          <div style={{ marginTop: 10, borderTop: "1px solid var(--border)", paddingTop: 10 }}>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>Employees <input inputMode="numeric" value={employees} onChange={(e) => setEmployees(Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ width: 70, marginLeft: 4, fontSize: 12.5, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)" }} /></label>
              <label style={{ fontSize: 12, fontWeight: 700 }}>Named users <input inputMode="numeric" value={users} onChange={(e) => setUsers(Number(e.target.value.replace(/\D/g, "")) || 0)} style={{ width: 70, marginLeft: 4, fontSize: 12.5, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)" }} /></label>
            </div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <label style={{ fontSize: 12, fontWeight: 700 }}>Default discount
                <input inputMode="decimal" value={defaultDisc}
                  onChange={(e) => setDefaultDisc(Math.min(100, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0))}
                  style={{ width: 56, marginLeft: 4, fontSize: 12.5, padding: "3px 6px", borderRadius: 6, border: "1px solid var(--border)" }} />%
              </label>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>applies to any line you don&apos;t set individually</span>
            </div>

            <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
              <table style={{ width: "100%", minWidth: 520, borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ background: "#FBF8F1" }}>
                    <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>Product</th>
                    <th style={{ textAlign: "left", padding: "6px 6px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>Metric</th>
                    <th style={{ textAlign: "right", padding: "6px 6px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>List</th>
                    <th style={{ textAlign: "right", padding: "6px 6px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>Qty</th>
                    <th style={{ textAlign: "right", padding: "6px 6px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>Disc</th>
                    <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".4px", color: "var(--muted)" }}>Net / yr</th>
                  </tr>
                </thead>
                <tbody>
                  {["ERP", "EPM", "SCM", "HCM", "EnergyWater"].map((fam) => {
                    const items = prices.filter((p) => p.family === fam);
                    if (!items.length) return null;
                    return (
                      <Fragment key={fam}>
                        <tr><td colSpan={6} style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".5px", padding: "6px 8px 2px", background: "#FBF8F1" }}>{fam}</td></tr>
                        {items.map((p) => {
                          const on = qty[p.id] !== undefined;
                          const q = !on ? 0 : (qty[p.id] === -1 ? (perEmployee(p.metric) ? employees : users) : qty[p.id]);
                          const d = disc[p.id] ?? defaultDisc;
                          const net = (Number(p.list_price) || 0) * q * 12 * (1 - d / 100);
                          return (
                            <tr key={p.id} style={{ borderTop: "1px solid #F4EFE6", background: on ? "#FCFAF5" : undefined }}>
                              <td style={{ padding: "5px 8px" }}>
                                <label style={{ display: "flex", gap: 7, alignItems: "center", cursor: "pointer" }}>
                                  <input type="checkbox" checked={on}
                                    onChange={() => setQty((x) => { const n = { ...x }; if (on) delete n[p.id]; else n[p.id] = -1; return n; })} />
                                  <span>{p.name.replace(/ Cloud Service$/, "").slice(0, 40)}</span>
                                </label>
                              </td>
                              <td style={{ padding: "5px 6px", color: "var(--muted)", fontSize: 11 }}>{unitOf(p.metric)}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right", fontFamily: "ui-monospace, monospace" }}>${p.list_price}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>
                                {on ? (
                                  <input inputMode="numeric" value={qty[p.id] === -1 ? q : qty[p.id]}
                                    onChange={(e) => setQty((x) => ({ ...x, [p.id]: Number(e.target.value.replace(/\D/g, "")) || 0 }))}
                                    title="Quantity for this SKU"
                                    style={{ width: 58, fontSize: 12, padding: "2px 5px", borderRadius: 5, border: "1px solid var(--border)", textAlign: "right" }} />
                                ) : <span style={{ color: "var(--muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>
                                {on ? (
                                  <input inputMode="decimal" value={d}
                                    onChange={(e) => setDisc((x) => ({ ...x, [p.id]: Math.min(100, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0) }))}
                                    title="Discount % off list for this SKU"
                                    style={{ width: 48, fontSize: 12, padding: "2px 5px", borderRadius: 5, border: "1px solid var(--border)", textAlign: "right" }} />
                                ) : <span style={{ color: "var(--muted)" }}>—</span>}
                              </td>
                              <td style={{ padding: "5px 8px", textAlign: "right", fontFamily: "ui-monospace, monospace", fontWeight: on ? 700 : 400, color: on ? "var(--ink)" : "var(--muted)" }}>
                                {on ? (net >= 1e6 ? `$${(net / 1e6).toFixed(2)}M` : `$${Math.round(net).toLocaleString()}`) : "—"}
                              </td>
                            </tr>
                          );
                        })}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--muted)", textDecoration: "line-through" }}>{fmtM(listAnnual)} list</span>
              <span style={{ fontSize: 15, fontWeight: 800 }}>{fmtM(licenseAnnual)}/yr net</span>
              {listAnnual > 0 && <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--green)" }}>{blendedDisc.toFixed(0)}% blended discount</span>}
              <button className="mini" disabled={licenseAnnual <= 0} onClick={() => setInvestM(Math.round(licenseAnnual * 100) / 100)}>Use as investment →</button>
            </div>
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>
              List prices are Oracle&apos;s published rates{pricedAsOf ? ` (${pricedAsOf})` : ""}. Discounts are your own assumption —
              this is a working estimate for the business case, not a quote, and nothing here is sent to the customer.
            </div>
          </div>
        )}
      </div>

      {/* Results */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
        {[
          [fmtM(annual), "annual benefit"],
          [fmtM(threeYr), "3-year benefit"],
          [investM > 0 ? `${roi.toFixed(1)}×` : "—", "3-yr ROI"],
          [fmtM(omSave), "O&M efficiency"],
          [fmtM(capexSave), "capex efficiency"],
          [annual > 0 && investM > 0 ? `${Math.round(paybackMo)} mo` : "—", "payback"],
        ].map(([n, l]) => (
          <div key={l as string} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "10px", textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.01em" }}>{n}</div>
            <div style={{ fontSize: 10, color: "var(--ink2)", fontWeight: 700 }}>{l}</div>
          </div>
        ))}
      </div>

      <div className="noprint" style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button className="btn" disabled={busy || annual <= 0} onClick={writeCase}>{busy ? "Writing… (~20s)" : "🧾 Write the business case"}</button>
        {narr && <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} onClick={() => window.print()}>🖨️ Print / PDF</button>}
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}

      {narr && (
        <div className="card" style={{ padding: "16px 18px" }}>
          <div style={{ fontSize: 16, fontWeight: 800, lineHeight: 1.4, marginBottom: 10 }}>{narr.headline}</div>
          {narr.rationale.map((r, i) => <div key={i} style={{ fontSize: 13.5, lineHeight: 1.55, padding: "2px 0 2px 12px", textIndent: -12 }}>• {r}</div>)}
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 10 }}><b>Honest caveats:</b> {narr.risks}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.55, background: "#FAF6EE", border: "1px solid #E6CF94", borderRadius: 8, padding: "9px 12px", marginTop: 10, fontStyle: "italic" }}>&ldquo;{narr.cfo_line}&rdquo;</div>
          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 10 }}>
            Baselines from SEC/FERC filings · savings are assumption-driven estimates, stated as such · generated by AccountFluency.
          </div>
        </div>
      )}
    </div>
  );
}
