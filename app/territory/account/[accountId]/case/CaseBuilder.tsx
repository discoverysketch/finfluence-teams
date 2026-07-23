"use client";
import { useEffect, useState } from "react";

// Savings levers on the account's REAL figures. All math is deterministic and
// visible; the AI only writes the narrative around numbers it's handed.
type Narr = { headline: string; rationale: string[]; risks: string; cfo_line: string };
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(2)}B` : `$${v >= 10 ? Math.round(v) : v.toFixed(1)}M`);

export default function CaseBuilder({ entityId, company, dealValueUsd }: { entityId: string; company: string; dealValueUsd: number | null }) {
  const [base, setBase] = useState<{ om: number | null; capex: number | null; revenue: number | null; rateBase: number | null }>({ om: null, capex: null, revenue: null, rateBase: null });
  const [loading, setLoading] = useState(true);
  // Levers (the rep's assumptions — always shown as assumptions)
  const [omPct, setOmPct] = useState(1.5);
  const [capexPct, setCapexPct] = useState(1.0);
  const [closeDays, setCloseDays] = useState(3);
  const [financeFtes, setFinanceFtes] = useState(25);
  const [investM, setInvestM] = useState<number>(dealValueUsd ? Math.round((dealValueUsd / 1e6) * 10) / 10 : 1.5);
  const [narr, setNarr] = useState<Narr | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

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
        }
      } catch { /* levers still work with manual entry */ }
      setLoading(false);
    })();
  }, [entityId]);

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
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
          <span style={{ fontSize: 12.5, fontWeight: 700 }}>Indicative investment ($M)</span>
          <input inputMode="decimal" value={investM} onChange={(e) => setInvestM(Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)}
            style={{ width: 90, fontSize: 13, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border)" }} />
          {dealValueUsd ? <span style={{ fontSize: 11, color: "var(--muted)" }}>prefilled from Deal $</span> : null}
        </div>
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
