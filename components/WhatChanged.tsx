"use client";
import { useState } from "react";

// "What changed" — YoY diff of the fresh filing, deterministic numbers + AI
// narration. Rendered from earnings signal cards and the Hub.
type Delta = { key: string; label: string; cur: number; prev: number; chg: number | null };
type Narrative = { headline: string; changes: string[]; talk_track: string; watch: string };
const fmtM = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.round(Math.abs(v)) + "M"}`;

export default function WhatChanged({ entityId }: { entityId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [err, setErr] = useState("");
  const [data, setData] = useState<{ narrative: Narrative; delta: Delta[]; curLabel: string; prevLabel: string } | null>(null);

  async function generate() {
    setState("loading"); setErr("");
    try {
      const r = await fetch("/api/what-changed", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.narrative) { setErr(j?.error || "Comparison failed."); setState("error"); return; }
      setData(j); setState("done");
    } catch { setErr("Network error."); setState("error"); }
  }

  if (state !== "done") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <button onClick={generate} disabled={state === "loading"}
          style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: "#006B72", cursor: state === "loading" ? "default" : "pointer" }}>
          📊 {state === "loading" ? "Comparing periods… (~20s)" : "What changed?"}
        </button>
        {state === "error" && <span style={{ fontSize: 11.5, color: "var(--red)" }}>{err}</span>}
      </span>
    );
  }

  const d = data!;
  return (
    <div style={{ marginTop: 8, background: "#F0F7F7", border: "1px solid #C4DEDF", borderRadius: 10, padding: "10px 12px", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#006B72" }}>
          📊 {d.prevLabel} → {d.curLabel}
        </span>
        <button onClick={() => setState("idle")} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.4, marginBottom: 8 }}>{d.narrative.headline}</div>
      <div style={{ background: "#fff", border: "1px solid #DBEBEB", borderRadius: 8, padding: "6px 10px", marginBottom: 8 }}>
        {d.delta.map((row) => (
          <div key={row.key} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "3px 0", fontSize: 12.5, borderBottom: "1px solid #F0F6F6" }}>
            <span style={{ color: "var(--ink2)" }}>{row.label}</span>
            <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
              {fmtM(row.prev)} → {fmtM(row.cur)}{" "}
              {row.chg != null && (
                <b style={{ color: row.chg >= 0 ? "#1B7A47" : "var(--red)" }}>{row.chg >= 0 ? "+" : ""}{row.chg}%</b>
              )}
            </span>
          </div>
        ))}
      </div>
      {d.narrative.changes.map((c, i) => <div key={i} style={{ fontSize: 13, lineHeight: 1.5, padding: "1px 0 1px 12px", textIndent: -12 }}>• {c}</div>)}
      <div style={{ fontSize: 13, lineHeight: 1.55, background: "#fff", border: "1px solid #DBEBEB", borderRadius: 8, padding: "8px 10px", margin: "8px 0", fontStyle: "italic" }}>&ldquo;{d.narrative.talk_track}&rdquo;</div>
      <div style={{ fontSize: 12, color: "var(--ink2)" }}><b style={{ color: "#006B72" }}>Watch:</b> {d.narrative.watch}</div>
    </div>
  );
}
