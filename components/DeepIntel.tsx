"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Deep public-data intel on an account: hiring signals, exec-comp metrics,
// generation fleet, and (for munis) a financial snapshot. Each is web-
// researched on demand, cached on the shared entity, and re-runnable.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Facet = "hiring" | "comp" | "fleet" | "muni";
const META: Record<Facet, { icon: string; label: string; blurb: string }> = {
  hiring: { icon: "🧑‍💼", label: "Hiring signals", blurb: "Open finance/ERP/systems roles — a live buying signal." },
  comp: { icon: "🎯", label: "What leadership is paid to hit", blurb: "Exec-comp metrics from the proxy — sell to the number their bonus depends on." },
  fleet: { icon: "⚡", label: "Generation fleet", blurb: "Capacity, fuel mix, notable plants — for asset & capital conversations." },
  muni: { icon: "🏛️", label: "Muni financial snapshot", blurb: "Revenue, debt, customers, rating from EMMA/CAFR — for non-SEC accounts." },
};

export default function DeepIntel({ entityId }: { entityId: string }) {
  const supabase = createClient();
  const [data, setData] = useState<Record<string, any>>({});
  const [isMuni, setIsMuni] = useState(false);
  const [busy, setBusy] = useState<Facet | null>(null);
  const [open, setOpen] = useState<Facet | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    (async () => {
      const { data: e } = await supabase.from("entities")
        .select("hiring_json, comp_json, fleet_json, muni_json, data_tier, entity_type").eq("id", entityId).maybeSingle();
      if (e) {
        setData({ hiring: e.hiring_json, comp: e.comp_json, fleet: e.fleet_json, muni: e.muni_json });
        setIsMuni(e.data_tier === "D" || e.data_tier === "C" || ["muni", "coop"].includes(e.entity_type ?? ""));
      }
    })();
  }, [entityId, supabase]);

  async function research(mode: Facet) {
    setBusy(mode); setErr("");
    try {
      const r = await fetch("/api/enrich-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, mode }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.data) { setErr(j?.error || "Research failed."); return; }
      setData((d) => ({ ...d, [mode]: j.data })); setOpen(mode);
    } catch { setErr("Network error."); }
    finally { setBusy(null); }
  }

  const facets: Facet[] = isMuni ? ["hiring", "comp", "fleet", "muni"] : ["hiring", "comp", "fleet"];
  const Src = ({ url }: { url?: string }) => url ? <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--blue)", fontWeight: 700 }}>source ↗</a> : null;

  return (
    <>
      <div className="secttl">🔎 Deep intel</div>
      <div className="card" style={{ padding: "6px 12px" }}>
        {facets.map((f, i) => {
          const d = data[f];
          const m = META[f];
          const isOpen = open === f;
          return (
            <div key={f} style={{ borderTop: i ? "1px solid #F0EAE0" : "none", padding: "9px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setOpen(isOpen ? null : f)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{m.icon} {m.label}</span>
                  {d && f === "hiring" && d.signal && <span style={{ marginLeft: 8, background: d.signal === "hot" ? "#B23A2E" : d.signal === "warm" ? "var(--gold)" : "#8A7E6E", color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: "1px 6px" }}>{d.signal.toUpperCase()}</span>}
                  {d && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>}
                </button>
                <button className="mini" onClick={() => research(f)} disabled={busy === f}>
                  {busy === f ? "…" : d ? "↻" : "Research"}
                </button>
              </div>
              {!d && !isOpen && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{m.blurb}</div>}
              {isOpen && d && (
                <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.5 }}>
                  {d.summary && <div style={{ marginBottom: 6 }}>{d.summary}</div>}
                  {f === "hiring" && (d.roles ?? []).map((r: any, j: number) => (
                    <div key={j} style={{ padding: "4px 0", borderTop: j ? "1px solid #F7F2E9" : "none" }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.title}</div>
                      <div style={{ fontSize: 12, color: "var(--ink2)" }}>{r.why} <Src url={r.source} /></div>
                    </div>
                  ))}
                  {f === "comp" && (<>
                    {(d.metrics ?? []).map((r: any, j: number) => (
                      <div key={j} style={{ padding: "4px 0", borderTop: j ? "1px solid #F7F2E9" : "none" }}>
                        <div style={{ fontWeight: 700, fontSize: 12.5 }}>{r.metric}</div>
                        <div style={{ fontSize: 12, color: "var(--ink2)" }}>{r.detail}</div>
                        <div style={{ fontSize: 12, color: "#006B72" }}><b>Angle:</b> {r.angle}</div>
                      </div>
                    ))}
                    {d.employees ? <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>~{Number(d.employees).toLocaleString()} employees</div> : null}
                    <div style={{ marginTop: 4 }}><Src url={d.source} /></div>
                  </>)}
                  {f === "fleet" && (<>
                    {d.total_mw > 0 && <div style={{ fontSize: 13, fontWeight: 700 }}>≈ {Number(d.total_mw).toLocaleString()} MW capacity</div>}
                    {(d.mix ?? []).length > 0 && <div style={{ fontSize: 12.5, color: "var(--ink2)", margin: "3px 0" }}>{d.mix.map((x: any) => `${x.fuel} ${Math.round(x.share_pct)}%`).join(" · ")}</div>}
                    {(d.notable ?? []).map((x: string, j: number) => <div key={j} style={{ fontSize: 12, padding: "1px 0 1px 12px", textIndent: -12 }}>· {x}</div>)}
                    <div style={{ marginTop: 4 }}><Src url={d.source} /></div>
                  </>)}
                  {f === "muni" && (<>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", fontSize: 12.5 }}>
                      {d.revenue_musd ? <div><b>Revenue</b> ${Math.round(d.revenue_musd)}M</div> : null}
                      {d.debt_musd ? <div><b>Debt</b> ${Math.round(d.debt_musd)}M</div> : null}
                      {d.customers ? <div><b>Customers</b> {Number(d.customers).toLocaleString()}</div> : null}
                      {d.rating ? <div><b>Rating</b> {d.rating}</div> : null}
                    </div>
                    <div style={{ marginTop: 4 }}><Src url={d.source} /></div>
                  </>)}
                  <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>Public sources · verify before relying on it.</div>
                </div>
              )}
            </div>
          );
        })}
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, margin: "6px 0 4px" }}>{err}</p>}
      </div>
    </>
  );
}
