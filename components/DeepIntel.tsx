"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Deep public-data intel on an account: hiring signals, exec-comp metrics,
// generation fleet, and (for munis) a financial snapshot. Each is web-
// researched on demand, cached on the shared entity, and re-runnable.
// Each lookup takes ~1 minute, so the UI has to SHOW that it's working —
// one button researches every topic, two at a time, with live progress.
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
  const [busy, setBusy] = useState<Facet[]>([]);
  const [sweep, setSweep] = useState({ running: false, done: 0, total: 0 });
  const [elapsed, setElapsed] = useState(0);
  const [open, setOpen] = useState<Facet | null>(null);
  // Errors are per-topic: concurrent lookups would otherwise wipe each
  // other's message and a failed topic would fail silently.
  const [errs, setErrs] = useState<Partial<Record<Facet, string>>>({});

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

  const facets: Facet[] = isMuni ? ["hiring", "comp", "fleet", "muni"] : ["hiring", "comp", "fleet"];
  const anyBusy = busy.length > 0;

  // A running clock is the honest signal that a slow lookup is still alive.
  useEffect(() => {
    if (!anyBusy) { setElapsed(0); return; }
    const t0 = Date.now();
    const id = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(id);
  }, [anyBusy]);

  async function research(mode: Facet, focus = true) {
    setBusy((b) => (b.includes(mode) ? b : [...b, mode]));
    setErrs((e) => ({ ...e, [mode]: undefined }));
    try {
      const r = await fetch("/api/enrich-account", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, mode }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.data) { setErrs((e) => ({ ...e, [mode]: j?.error || "Research failed — try again." })); return false; }
      setData((d) => ({ ...d, [mode]: j.data }));
      // A single run opens that topic; a sweep opens whichever lands first.
      setOpen((o) => (focus ? mode : o ?? mode));
      return true;
    } catch {
      setErrs((e) => ({ ...e, [mode]: "Network error — check your connection." }));
      return false;
    } finally { setBusy((b) => b.filter((x) => x !== mode)); }
  }

  // Research every topic at once — they're independent lookups, so the whole
  // sweep takes about as long as the slowest one, and every row shows progress.
  async function researchAll() {
    const missing = facets.filter((f) => !data[f]);
    const list = missing.length ? missing : facets; // nothing missing = refresh everything
    setSweep({ running: true, done: 0, total: list.length });
    await Promise.all(list.map((m) => research(m, false).finally(() => setSweep((s) => ({ ...s, done: s.done + 1 })))));
    setSweep((s) => ({ ...s, running: false }));
  }

  const missingCount = facets.filter((f) => !data[f]).length;
  const Src = ({ url }: { url?: string }) => url ? <a href={url} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "var(--blue)", fontWeight: 700 }}>source ↗</a> : null;
  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  return (
    <>
      <div className="secttl">🔎 Deep intel</div>
      <div className="card" style={{ padding: "6px 12px" }}>

        {/* ---- one button for every topic, with live progress ---- */}
        <div style={{ padding: "8px 0 10px", borderBottom: "1px solid #F0EAE0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <button className="btn" style={{ background: "var(--teal)", padding: "8px 13px", fontSize: 13 }}
              disabled={anyBusy} onClick={researchAll}>
              {sweep.running
                ? `Researching all ${sweep.total} topics…`
                : missingCount ? `🔎 Research all ${missingCount} topic${missingCount === 1 ? "" : "s"}` : "↻ Refresh all topics"}
            </button>
            {anyBusy
              ? <span style={{ fontSize: 12.5, color: "var(--ink2)", fontWeight: 600 }}>
                  <span className="di-live">●</span> {sweep.running ? `${sweep.done} of ${sweep.total} done` : busy.map((f) => META[f].label).join(" · ")} · {mmss(elapsed)}
                </span>
              : <span style={{ fontSize: 11.5, color: "var(--muted)" }}>Public web research · about a minute, all topics at once</span>}
          </div>
          {sweep.running && (
            <div className="di-track"><div className="di-fill" style={{ width: `${Math.round((sweep.done / Math.max(1, sweep.total)) * 100)}%` }} /></div>
          )}
        </div>

        {facets.map((f, i) => {
          const d = data[f];
          const m = META[f];
          const isOpen = open === f;
          const running = busy.includes(f);
          const fErr = errs[f];
          return (
            <div key={f} style={{ borderTop: i ? "1px solid #F0EAE0" : "none", padding: "9px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <button onClick={() => setOpen(isOpen ? null : f)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{m.icon} {m.label}</span>
                  {d && f === "hiring" && d.signal && <span style={{ marginLeft: 8, background: d.signal === "hot" ? "#B23A2E" : d.signal === "warm" ? "var(--gold)" : "#8A7E6E", color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: "1px 6px" }}>{d.signal.toUpperCase()}</span>}
                  {d && <span style={{ marginLeft: 6, fontSize: 11, color: "var(--muted)" }}>{isOpen ? "▾" : "▸"}</span>}
                </button>
                <button className="mini" onClick={() => research(f)} disabled={anyBusy}>
                  {running ? "…" : d ? "↻" : "Research"}
                </button>
              </div>
              {running && (
                <div className="di-work">
                  <span className="di-bar"><span /></span> Searching public sources… {mmss(elapsed)}
                </div>
              )}
              {fErr && !running && (
                <div style={{ fontSize: 11.5, color: "var(--red)", fontWeight: 600, marginTop: 3 }}>
                  {fErr} <button className="di-retry" onClick={() => research(f)} disabled={anyBusy}>Retry</button>
                </div>
              )}
              {!d && !isOpen && !running && !fErr && <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>{m.blurb}</div>}
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
      </div>

      <style>{`
        .di-track{height:4px;background:#EDE7DA;border-radius:3px;overflow:hidden;margin-top:9px}
        .di-fill{height:100%;background:var(--teal);border-radius:3px;transition:width .4s ease}
        .di-work{display:flex;align-items:center;gap:7px;font-size:11.5px;color:var(--teal);font-weight:600;margin-top:5px}
        .di-bar{display:block;width:64px;height:3px;background:#DCEBEB;border-radius:2px;overflow:hidden;flex:none}
        .di-bar>span{display:block;width:40%;height:100%;background:var(--teal);border-radius:2px;animation:di-slide 1.1s ease-in-out infinite}
        @keyframes di-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}
        .di-retry{background:none;border:none;color:var(--red);font-weight:700;font-size:11.5px;text-decoration:underline;cursor:pointer;padding:0 0 0 2px}
        .di-retry:disabled{opacity:.5;cursor:default}
        .di-live{color:var(--teal);animation:di-blink 1.2s ease-in-out infinite}
        @keyframes di-blink{0%,100%{opacity:1}50%{opacity:.25}}
        @media (prefers-reduced-motion:reduce){.di-bar>span,.di-live{animation:none}}
      `}</style>
    </>
  );
}
