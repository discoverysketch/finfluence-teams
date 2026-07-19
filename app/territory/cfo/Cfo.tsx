"use client";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SFX, unlockAudio } from "@/lib/sfx";

type Ent = { id: string; canonical_name: string; ticker: string | null; data_tier: string | null };
export type Acct = { id: string; entity: Ent };
type Msg = { role: "cfo" | "rep"; content: string };
type Score = { financialFluency: number; businessRelevance: number; composure: number; overall: number; coaching: string[]; nextTime: string; conceptsTested: string[]; passed: boolean };

export default function Cfo({ userId, accounts }: { userId: string; accounts: Acct[] }) {
  const supabase = createClient();
  const [phase, setPhase] = useState<"pick" | "chat" | "score">("pick");
  const [entityId, setEntityId] = useState("");
  const [company, setCompany] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [score, setScore] = useState<Score | null>(null);
  const [coach, setCoach] = useState<{ loading?: boolean; answer?: string; why?: string[]; proof?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const repTurns = msgs.filter((m) => m.role === "rep").length;

  function scrollDown() { setTimeout(() => scrollRef.current?.scrollTo({ top: 9e9, behavior: "smooth" }), 60); }

  async function begin(a: Acct) {
    setEntityId(a.entity.id); setCompany(a.entity.canonical_name);
    setPhase("chat"); setMsgs([]); setScore(null); setErr(""); setBusy(true);
    try {
      const r = await fetch("/api/cfo-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId: a.entity.id, messages: [], mode: "chat" }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Couldn't start."); setPhase("pick"); return; }
      setMsgs([{ role: "cfo", content: j.reply }]); scrollDown();
    } catch { setErr("Network error."); setPhase("pick"); }
    finally { setBusy(false); }
  }

  async function send() {
    const text = input.trim(); if (!text || busy) return;
    unlockAudio();
    const next = [...msgs, { role: "rep" as const, content: text }];
    setMsgs(next); setInput(""); setBusy(true); scrollDown();
    try {
      const r = await fetch("/api/cfo-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, messages: next, mode: "chat" }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "CFO unavailable."); return; }
      setMsgs([...next, { role: "cfo", content: j.reply }]); SFX.flip(); scrollDown();
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  async function coachMe() {
    if (coach?.loading) return;
    setCoach({ loading: true });
    try {
      const r = await fetch("/api/cfo-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, messages: msgs, mode: "coach" }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Coach unavailable."); setCoach(null); return; }
      setCoach(j.coach);
    } catch { setErr("Network error."); setCoach(null); }
  }

  async function wrapUp() {
    if (busy) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/cfo-sim", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, messages: msgs, mode: "score" }) });
      const j = await r.json();
      if (!r.ok) { setErr(j.error || "Scoring failed."); setBusy(false); return; }
      const s = j.score as Score;
      setScore(s); setPhase("score");
      (s.passed ? SFX.win : SFX.wrong)();
      try {
        if (s.conceptsTested?.length) {
          await supabase.from("score_events").insert(
            s.conceptsTested.map((c) => ({ user_id: userId, concept_tag: c, correct: s.passed, difficulty: "hard", source_mode: "cfo_sim" }))
          );
        }
      } catch { /* non-fatal */ }
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  if (phase === "pick") {
    return (
      <div>
        {err && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{err}</div>}
        <div className="card">
          <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Whose CFO do you want to face?</label>
          <select defaultValue="" onChange={(e) => { const a = accounts.find((x) => x.entity.id === e.target.value); if (a) begin(a); }} disabled={busy}
            style={{ width: "100%", marginTop: 6, padding: "10px 12px", fontSize: 14 }}>
            <option value="" disabled>{busy ? "Walking in…" : "Choose an account…"}</option>
            {accounts.map((a) => <option key={a.id} value={a.entity.id}>{a.entity.canonical_name}{a.entity.ticker ? ` (${a.entity.ticker})` : ""}</option>)}
          </select>
        </div>
      </div>
    );
  }

  if (phase === "score" && score) {
    const Bar = ({ label, v }: { label: string; v: number }) => (
      <div style={{ marginBottom: 8 }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, fontWeight: 600 }}><span>{label}</span><span>{v}</span></div>
        <div style={{ height: 8, background: "var(--cream2)", borderRadius: 5, overflow: "hidden", marginTop: 3 }}>
          <div style={{ width: `${Math.max(0, Math.min(100, v))}%`, height: "100%", background: v >= 60 ? "var(--green)" : "var(--gold)" }} />
        </div>
      </div>
    );
    return (
      <div>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ fontSize: 20, marginBottom: 2 }}>{company} — CFO rehearsal</h2>
          <div style={{ fontSize: 40, fontWeight: 800, color: score.overall >= 60 ? "var(--green)" : "var(--red)" }}>{score.overall}</div>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>overall</div>
        </div>
        <div className="card" style={{ marginTop: 12 }}>
          <Bar label="Financial fluency" v={score.financialFluency} />
          <Bar label="Business relevance" v={score.businessRelevance} />
          <Bar label="Composure" v={score.composure} />
        </div>
        <div className="card" style={{ marginTop: 10, background: "#F7F2E9", borderColor: "#E6CF94" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#9A6700", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>Coaching</div>
          <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>{score.coaching.map((c, i) => <li key={i} style={{ fontSize: 14, marginBottom: 4 }}>{c}</li>)}</ul>
          <div style={{ fontSize: 13.5 }}><b>Try next time:</b> {score.nextTime}</div>
        </div>
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>Feeds your Acumen on {score.conceptsTested.join(", ") || "the concepts tested"}.</p>
        <button className="btn" style={{ marginTop: 6 }} onClick={() => { setPhase("pick"); setMsgs([]); setScore(null); }}>New rehearsal</button>
      </div>
    );
  }

  // chat
  return (
    <div>
      {err && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{err}</div>}
      <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>💼 CFO of {company}</div>
      <div ref={scrollRef} style={{ maxHeight: "52vh", overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, padding: 2 }}>
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "cfo" ? "flex-start" : "flex-end", maxWidth: "85%", background: m.role === "cfo" ? "#fff" : "var(--red)", color: m.role === "cfo" ? "var(--ink)" : "#fff", border: m.role === "cfo" ? "1px solid var(--border)" : "none", borderRadius: 12, padding: "10px 13px", fontSize: 14.5, lineHeight: 1.45 }}>
            {m.content}
          </div>
        ))}
        {busy && <div style={{ alignSelf: "flex-start", fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>CFO is thinking…</div>}
      </div>
      {coach && (
        <div className="card" style={{ marginTop: 10, background: "#FAF6EE", borderColor: "#E6CF94" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "#9A6700" }}>🎓 Your coach · the CFO can&apos;t see this</span>
            <button onClick={() => setCoach(null)} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
          {coach.loading ? (
            <div style={{ fontSize: 13, color: "var(--ink2)" }}>Reading the room and your product playbook…</div>
          ) : (
            <>
              <p style={{ margin: "0 0 8px", fontSize: 14.5, lineHeight: 1.55 }}>{coach.answer}</p>
              {(coach.why?.length ?? 0) > 0 && (
                <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>
                  {coach.why!.map((w, i) => <li key={i} style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 2 }}>{w}</li>)}
                </ul>
              )}
              {coach.proof && <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--ink2)" }}><b>Proof point:</b> {coach.proof}</p>}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => { setInput(coach.answer || ""); setCoach(null); }}>Use this — edit before sending</button>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>Verify product claims before real meetings.</span>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Your answer…" disabled={busy} style={{ flex: 1 }} />
        <button className="btn" onClick={send} disabled={busy || !input.trim()}>Send</button>
      </div>
      <button onClick={coachMe} disabled={!!coach?.loading}
        style={{ marginTop: 8, width: "100%", background: "#fff", border: "1.5px dashed #E6CF94", color: "#9A6700", borderRadius: 10, padding: "9px 14px", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
        🎓 {coach?.loading ? "Coaching…" : "Coach me — how should I answer this?"}
      </button>
      <button className="btn" style={{ marginTop: 10, background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)", width: "100%" }}
        onClick={wrapUp} disabled={busy || repTurns < 1}>
        {repTurns < 1 ? "Answer at least once to wrap up" : "Wrap up & score me →"}
      </button>
    </div>
  );
}
