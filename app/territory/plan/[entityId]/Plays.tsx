"use client";
import { useState } from "react";

type Play = { title: string; detail: string };
type FactMap = Record<string, number>;

export default function Plays({ entityId, peerName, peerFacts, weakConcepts }: { entityId: string; peerName: string | null; peerFacts: FactMap | null; weakConcepts: string[] }) {
  const [plays, setPlays] = useState<Play[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  async function generate() {
    setLoading(true); setErr("");
    try {
      const r = await fetch("/api/plan-plays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, peerName, peerFacts, weakConcepts }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't generate plays."); return; }
      setPlays(j.plays ?? []);
    } catch { setErr("Network error."); }
    finally { setLoading(false); }
  }

  return (
    <div>
      <h2 style={{ fontSize: 15 }}>Suggested plays</h2>
      {err && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 10 }}>{err}</div>}

      {!plays && (
        <button className="btn noprint" disabled={loading} onClick={generate}>{loading ? "Drafting plays…" : "✨ Generate suggested plays"}</button>
      )}

      {plays && plays.map((p, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: "10px 13px" }}>
          <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 2 }}>{i + 1}. {p.title}</div>
          <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>{p.detail}</div>
        </div>
      ))}

      {plays && (
        <div className="noprint" style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button className="btn" onClick={() => window.print()}>🖨️ Print / Save as PDF</button>
          <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} disabled={loading} onClick={generate}>Regenerate</button>
        </div>
      )}

      <style>{`@media print { .noprint { display: none !important; } .appbar, .nav { display: none !important; } body { background: #fff; } }`}</style>
    </div>
  );
}
