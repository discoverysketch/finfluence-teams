"use client";
import { useEffect, useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { scoreTerritory, whyLine, DEFAULT_WEIGHTS, SIGNAL_LABEL, type SignalKey, type SignalWeights } from "@/lib/signals";
import type { FactMap } from "@/lib/facts";

type Item = { accountId: string; entityId: string; name: string; ticker: string | null; tier: string | null; facts: FactMap; period: string | null; error: string | null };

const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700" };
const fmtM = (v?: number) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.round(Math.abs(v)) + "M"}`);
const fmtCount = (v?: number) => (v == null ? "—" : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
const TABLE_METRICS: [string, string][] = [
  ["revenue", "Revenue"], ["operatingIncome", "Operating income"], ["netIncome", "Net income"],
  ["totalAssets", "Total assets"], ["totalEquity", "Total equity"], ["totalDebt", "Total debt"],
  ["operatingCashFlow", "Op. cash flow"], ["capex", "Capex"],
  ["eia_customers", "Customers (EIA)"], ["eia_revenue", "Retail revenue (EIA)"],
  ["ferc_net_plant", "Net utility plant (FERC)"], ["ferc_cwip", "CWIP (FERC)"], ["ferc_om", "Electric O&M (FERC)"],
];
const fmtCell = (k: string, v?: number) => (k === "eia_customers" ? fmtCount(v) : fmtM(v));
const CHART_METRICS: [string, string][] = [
  ["revenue", "Revenue"], ["totalAssets", "Total assets"], ["totalDebt", "Total debt"],
  ["operatingCashFlow", "Op. cash flow"], ["netIncome", "Net income"],
];
const BARS = ["#B23A2E", "#0572CE", "#9A6700", "#1B7A47"];

export default function Board() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [weights, setWeights] = useState<SignalWeights>(DEFAULT_WEIGHTS);
  const [sel, setSel] = useState<string[]>([]);
  const [chartKey, setChartKey] = useState("revenue");
  const [narr, setNarr] = useState<{ loading?: boolean; text?: string }>({});

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/territory-facts");
        const j = await r.json();
        setItems(j.items ?? []);
      } catch { setItems([]); }
      setLoading(false);
    })();
  }, []);

  // Scorable = enough SEC facts OR EIA ops (Tier B munis/co-ops score on
  // scale + customer base even without a single SEC figure).
  const canScore = (i: Item) => Object.keys(i.facts).filter((k) => !k.startsWith("eia_") && !k.startsWith("ferc_")).length >= 3 || i.facts.eia_customers != null || i.facts.ferc_net_plant != null;
  const scorable = useMemo(() => (items ?? []).filter(canScore), [items]);
  const unscored = useMemo(() => (items ?? []).filter((i) => !canScore(i)), [items]);
  const scored = useMemo(() => scoreTerritory(scorable.map((i) => ({ ...i, id: i.entityId })), weights), [scorable, weights]);

  const selItems = scored.filter((s) => sel.includes(s.entityId));
  function toggle(id: string) {
    setNarr({});
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));
  }

  async function narrate() {
    if (selItems.length < 2) return;
    setNarr({ loading: true });
    try {
      const r = await fetch("/api/compare-narrative", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companies: selItems.map((s) => ({ company: s.name, period: s.period, facts: s.facts })) }),
      });
      const j = await r.json();
      setNarr({ text: r.ok ? j.text : `(${j.error || "Unavailable."})` });
    } catch { setNarr({ text: "(Narrative unavailable.)" }); }
  }

  if (loading) return <div className="card">Pulling financials for your book… (first run fetches from SEC; after that it&apos;s cached)</div>;
  if (!scored.length) return <div className="card">No account financials yet. Add SEC-listed accounts on the <a href="/territory">Accounts</a> page first.</div>;

  const chartData = selItems.map((s) => ({ name: s.ticker || s.name.slice(0, 10), value: s.facts[chartKey] ?? 0 }));

  return (
    <div>
      {/* ---- Signal tiering ---- */}
      <div className="secttl">Signal tiers</div>
      <div className="card" style={{ padding: "10px 12px", marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 8 }}>Weights — drag to re-tier</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
          {(Object.keys(SIGNAL_LABEL) as SignalKey[]).map((k) => (
            <label key={k} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink2)" }}>
              {SIGNAL_LABEL[k]} <span style={{ color: "var(--muted)" }}>({weights[k].toFixed(1)})</span>
              <input type="range" min={0} max={2} step={0.1} value={weights[k]} onChange={(e) => setWeights((w) => ({ ...w, [k]: Number(e.target.value) }))} style={{ width: "100%" }} />
            </label>
          ))}
        </div>
      </div>

      {scored.map((s) => (
        <div key={s.entityId} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
          <label style={{ display: "flex", alignItems: "center" }}>
            <input type="checkbox" checked={sel.includes(s.entityId)} onChange={() => toggle(s.entityId)} style={{ width: 18, height: 18 }} />
          </label>
          <span style={{ background: TIER_COLOR[s.tier], color: "#fff", fontWeight: 800, fontSize: 14, borderRadius: 7, width: 26, height: 26, display: "grid", placeItems: "center" }}>{s.tier}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{s.name}{s.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {s.ticker}</span> : null}</div>
            <div style={{ fontSize: 12, color: "var(--ink2)" }}>{whyLine(s.parts)}</div>
          </div>
          <div style={{ textAlign: "right" }}><div style={{ fontWeight: 800, fontSize: 18 }}>{s.score}</div><div style={{ fontSize: 10, color: "var(--muted)" }}>signal</div></div>
        </div>
      ))}
      {unscored.length > 0 && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
          {unscored.length} account{unscored.length === 1 ? "" : "s"} without SEC or EIA data not scored{unscored.some((u) => u.error) ? " (research them via Add accounts → Private)" : ""}.
        </p>
      )}

      {/* ---- Comparison workbench ---- */}
      <div className="secttl" style={{ marginTop: 22 }}>Comparison workbench</div>
      {selItems.length < 2 ? (
        <div className="card" style={{ fontSize: 13, color: "var(--ink2)" }}>Tick 2–4 accounts above to compare them side by side.</div>
      ) : (
        <>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 13, minWidth: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 10px", color: "var(--ink2)" }}>Metric</th>
                  {selItems.map((s) => <th key={s.entityId} style={{ padding: "6px 10px", textAlign: "right", fontSize: 12 }}>{s.ticker || s.name.slice(0, 10)}</th>)}
                </tr>
              </thead>
              <tbody>
                {TABLE_METRICS.map(([k, label]) => (
                  <tr key={k}>
                    <td style={{ padding: "5px 10px", fontWeight: 600, whiteSpace: "nowrap", borderTop: "1px solid #F0EAE0" }}>{label}</td>
                    {selItems.map((s) => <td key={s.entityId} style={{ padding: "5px 10px", textAlign: "right", fontFamily: "ui-monospace, monospace", borderTop: "1px solid #F0EAE0" }}>{fmtCell(k, s.facts[k])}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0 4px" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Chart:</span>
            <select value={chartKey} onChange={(e) => setChartKey(e.target.value)} style={{ width: "auto", padding: "4px 8px", fontSize: 13 }}>
              {CHART_METRICS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </div>
          <div className="card" style={{ padding: "10px 6px" }}>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} margin={{ top: 6, right: 10, left: 0, bottom: 0 }}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtM(v as number)} width={54} />
                <Tooltip formatter={(v) => fmtM(v as number)} />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, i) => <Cell key={i} fill={BARS[i % BARS.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          <button className="btn" style={{ marginTop: 12 }} disabled={narr.loading} onClick={narrate}>
            {narr.loading ? "Drafting…" : "🎤 Draft CFO narrative"}
          </button>
          {narr.text && (
            <div className="card" style={{ marginTop: 10, background: "#F7F2E9", borderColor: "#E6CF94" }}>
              <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>{narr.text}</p>
            </div>
          )}
        </>
      )}

      <style>{`.secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:10px 0 8px}`}</style>
    </div>
  );
}
