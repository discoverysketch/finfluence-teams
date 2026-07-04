"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SFX, sparkle, unlockAudio } from "@/lib/sfx";

type Ent = { id: string; canonical_name: string; ticker: string | null; data_tier: string | null };
export type Acct = { id: string; entity: Ent };
type FactMap = Record<string, number>;
type Peer = { id: string; company: string; ticker: string | null; data_tier: string | null; period: string; facts: FactMap; similarity: number };
type Target = { id: string; company: string; period: string; facts: FactMap };
type Q = { q: string; concept: string; options: { label: string; ok: boolean }[]; answer: number; ex: string };

const fmtM = (v: number) => { const a = Math.abs(v); return `${v < 0 ? "-" : ""}$${a >= 1000 ? (a / 1000).toFixed(1) + "B" : Math.round(a) + "M"}`; };
const pct = (v: number) => `${Math.round(v * 100)}%`;

function buildDuel(tName: string, tF: FactMap, pName: string, pF: FactMap): Q[] {
  const qs: Q[] = [];
  const cmp = (q: string, concept: string, a: number | null, b: number | null, ex: (a: number, b: number) => string) => {
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return;
    const aBig = a >= b;
    qs.push({ q, concept, options: [{ label: tName, ok: aBig }, { label: pName, ok: !aBig }], answer: aBig ? 0 : 1, ex: ex(a, b) });
  };
  const lev = (f: FactMap) => (f.totalDebt != null && f.totalAssets ? f.totalDebt / f.totalAssets : null);
  const cash = (f: FactMap) => (f.operatingCashFlow != null && f.revenue ? f.operatingCashFlow / f.revenue : null);
  const capexInt = (f: FactMap) => (f.capex != null && f.revenue ? Math.abs(f.capex) / f.revenue : null);
  const roa = (f: FactMap) => (f.netIncome != null && f.totalAssets ? f.netIncome / f.totalAssets : null);

  cmp("Which company has higher revenue?", "found", tF.revenue ?? null, pF.revenue ?? null, (a, b) => `${tName}: ${fmtM(a)} vs ${pName}: ${fmtM(b)} in revenue.`);
  cmp("Which carries more leverage (debt relative to assets)?", "liq", lev(tF), lev(pF), (a, b) => `${tName}: ${pct(a)} vs ${pName}: ${pct(b)} debt-to-assets.`);
  cmp("Which converts more of its revenue into operating cash?", "cash", cash(tF), cash(pF), (a, b) => `${tName}: ${pct(a)} vs ${pName}: ${pct(b)} operating cash margin.`);
  cmp("Which is investing more heavily (capex relative to revenue)?", "cash", capexInt(tF), capexInt(pF), (a, b) => `${tName}: ${pct(a)} vs ${pName}: ${pct(b)} of revenue reinvested as capex.`);
  cmp("Which earns more on its assets (return on assets)?", "prof", roa(tF), roa(pF), (a, b) => `${tName}: ${pct(a)} vs ${pName}: ${pct(b)} return on assets.`);
  return qs.slice(0, 5);
}

export default function Duel({ userId, accounts }: { userId: string; accounts: Acct[] }) {
  const supabase = createClient();
  const [phase, setPhase] = useState<"pick" | "peer" | "quiz" | "result">("pick");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [target, setTarget] = useState<Target | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [peerId, setPeerId] = useState<string>("");
  const [qs, setQs] = useState<Q[]>([]);
  const [qi, setQi] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [talk, setTalk] = useState<string>("");
  const [talkLoading, setTalkLoading] = useState(false);

  const peer = peers.find((p) => p.id === peerId) || null;

  async function pickAccount(entityId: string) {
    if (!entityId) return;
    setLoading(true); setMsg("");
    try {
      const r = await fetch(`/api/peer-suggest?entityId=${entityId}`);
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Couldn't suggest peers."); setLoading(false); return; }
      if (!j.peers?.length) { setMsg("No peers with data yet — an admin can run `npm run cache-peers` to warm the utility set."); setLoading(false); return; }
      setTarget(j.target); setPeers(j.peers); setPeerId(j.peers[0].id); setPhase("peer");
    } catch { setMsg("Network error."); }
    setLoading(false);
  }

  function start() {
    if (!target || !peer) return;
    const built = buildDuel(target.company, target.facts, peer.company, peer.facts);
    if (built.length < 2) { setMsg("Not enough overlapping data to compare these two."); return; }
    setQs(built); setQi(0); setChosen(null); setAnswers([]); setTalk(""); setPhase("quiz");
  }

  function choose(i: number) {
    if (chosen != null) return;
    unlockAudio(); setChosen(i); setAnswers((a) => [...a, i]);
    if (qs[qi].options[i].ok) { SFX.correct(); if (typeof window !== "undefined") sparkle(window.innerWidth / 2, 200); }
    else SFX.wrong();
  }

  async function next() {
    if (qi + 1 < qs.length) { setQi(qi + 1); setChosen(null); return; }
    const score = answers.filter((a, i) => a === qs[i].answer).length;
    try {
      await supabase.from("score_events").insert(
        qs.map((q, i) => ({ user_id: userId, concept_tag: q.concept, correct: answers[i] === q.answer, difficulty: "med", source_mode: "duel" }))
      );
    } catch { /* non-fatal */ }
    (score / qs.length >= 0.6 ? SFX.win : SFX.wrong)();
    setPhase("result");
    // talk track
    if (target && peer) {
      setTalkLoading(true);
      try {
        const r = await fetch("/api/talk-track", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, peer: { company: peer.company, period: peer.period, facts: peer.facts } }),
        });
        const j = await r.json();
        setTalk(r.ok ? j.text : `(${j.error || "Talk track unavailable."})`);
      } catch { setTalk("(Talk track unavailable.)"); }
      setTalkLoading(false);
    }
  }

  // ---- pick ----
  if (phase === "pick") {
    return (
      <div>
        {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}
        <div className="card">
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Your account</label>
          <select defaultValue="" onChange={(e) => pickAccount(e.target.value)} disabled={loading} style={{ width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 14 }}>
            <option value="" disabled>{loading ? "Finding a peer…" : "Choose an account…"}</option>
            {accounts.map((a) => <option key={a.id} value={a.entity.id}>{a.entity.canonical_name}{a.entity.ticker ? ` (${a.entity.ticker})` : ""}</option>)}
          </select>
        </div>
      </div>
    );
  }

  // ---- peer confirm ----
  if (phase === "peer" && target) {
    return (
      <div>
        {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}
        <div className="card" style={{ textAlign: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14 }}>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{target.company}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>your account</div></div>
            <div style={{ fontSize: 20, fontWeight: 800, color: "var(--red)" }}>vs</div>
            <div style={{ flex: 1 }}><div style={{ fontWeight: 800, fontSize: 16 }}>{peer?.company}</div><div style={{ fontSize: 11, color: "var(--muted)" }}>{peer ? `${peer.similarity}% similar` : ""}</div></div>
          </div>
        </div>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)", display: "block", margin: "14px 0 4px" }}>Peer (auto-suggested — change if you like)</label>
        <select value={peerId} onChange={(e) => setPeerId(e.target.value)} style={{ width: "100%", padding: "10px 12px", fontSize: 14 }}>
          {peers.map((p) => <option key={p.id} value={p.id}>{p.company}{p.ticker ? ` (${p.ticker})` : ""} · {p.similarity}% similar</option>)}
        </select>
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button className="btn" onClick={start}>Start the duel →</button>
          <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} onClick={() => { setPhase("pick"); setMsg(""); }}>← Back</button>
        </div>
      </div>
    );
  }

  // ---- result ----
  if (phase === "result") {
    const score = answers.filter((a, i) => a === qs[i].answer).length;
    return (
      <div>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: 22, marginBottom: 2 }}>{target?.company} vs {peer?.company}</h2>
          <div style={{ fontSize: 38, fontWeight: 800, color: "var(--red)" }}>{score} / {qs.length}</div>
        </div>
        <div className="card" style={{ marginTop: 12, background: "#F7F2E9", borderColor: "#E6CF94" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9A6700", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>🎤 Your CFO talk track</div>
          {talkLoading ? <div style={{ fontSize: 13, color: "var(--ink2)" }}>Drafting…</div> : <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55 }}>{talk}</p>}
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Feeds your Acumen · figures from SEC EDGAR — verify against filings.</p>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => { setPhase("pick"); setTarget(null); setPeers([]); setMsg(""); }}>Another duel</button>
      </div>
    );
  }

  // ---- quiz ----
  const q = qs[qi];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{target?.company} <span style={{ color: "var(--muted)" }}>vs</span> {peer?.company}</span>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Q {qi + 1} of {qs.length}</span>
      </div>
      <div className="card">
        <div style={{ fontSize: 16.5, fontWeight: 700, margin: "2px 0 12px" }}>{q.q}</div>
        {q.options.map((o, i) => {
          let bg = "#fff", bd = "var(--border)", col = "var(--ink)";
          if (chosen != null) {
            if (o.ok) { bg = "#E8F5EE"; bd = "var(--green)"; col = "#135a34"; }
            else if (i === chosen) { bg = "#F9E7E3"; bd = "var(--red)"; col = "#9B2C1A"; }
          }
          return (
            <button key={i} onClick={() => choose(i)} disabled={chosen != null}
              style={{ display: "block", width: "100%", textAlign: "left", background: bg, border: `1.5px solid ${bd}`, color: col, borderRadius: 9, padding: "13px 15px", marginBottom: 8, fontSize: 15, fontWeight: 700, cursor: chosen == null ? "pointer" : "default" }}>
              {o.label}
            </button>
          );
        })}
        {chosen != null && (
          <>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, background: "#F7F2E9", borderLeft: "3px solid var(--gold)", borderRadius: 6, padding: "11px 13px", marginTop: 6 }}>{q.ex}</div>
            <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={next}>{qi + 1 < qs.length ? "Next" : "See talk track"}</button>
          </>
        )}
      </div>
    </div>
  );
}
