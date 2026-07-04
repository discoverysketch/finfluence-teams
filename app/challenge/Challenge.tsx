"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { buildQuiz, SAMPLE, FORMULAS, CHTAG, cf$, type Fin, type Question } from "@/lib/challenge";
import { SFX, sparkle, unlockAudio } from "@/lib/sfx";

const PICKS = ["NEE", "EXC", "SO", "DUK", "D", "AEP", "VST", "AES", "CMS", "UTL", "BRK.B"];

export default function Challenge({ userId }: { userId: string }) {
  const supabase = createClient();
  const [phase, setPhase] = useState<"entry" | "quiz" | "result">("entry");
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState("");
  const [data, setData] = useState<Fin | null>(null);
  const [qs, setQs] = useState<Question[]>([]);
  const [qi, setQi] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [showF, setShowF] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);

  async function analyze(tk?: string) {
    const t = (tk ?? ticker).trim().toUpperCase();
    if (!t) { setNote("Enter a ticker first."); return; }
    setTicker(t); setLoading(true); setNote("");
    let d: Fin;
    try {
      const r = await fetch(`/api/financials?ticker=${encodeURIComponent(t)}`);
      const j = await r.json();
      if (!j || j.error || (!j.revenue && !j.totalAssets)) throw new Error();
      d = j as Fin;
    } catch {
      setNote(`Couldn't pull live data for ${t} — showing a Unitil (UTL) sample so you can still play.`);
      d = SAMPLE;
    }
    setLoading(false);
    const built = buildQuiz(d);
    if (!built.length) { setNote("Not enough data to build a quiz — try another ticker."); return; }
    setData(d); setQs(built); setQi(0); setChosen(null); setShowF(false); setAnswers([]); setPhase("quiz");
  }

  function choose(i: number) {
    if (chosen != null) return;
    unlockAudio();
    setChosen(i);
    setAnswers((a) => [...a, i]);
    if (qs[qi].options[i].ok) {
      SFX.correct();
      if (typeof window !== "undefined") sparkle(window.innerWidth / 2, 220);
    } else {
      SFX.wrong();
    }
  }

  async function next() {
    if (qi + 1 < qs.length) { setQi(qi + 1); setChosen(null); setShowF(false); return; }
    // finish → persist
    const score = answers.filter((a, idx) => a === qs[idx].answer).length;
    try {
      await supabase.from("challenge_runs").insert({
        user_id: userId, mode: "single", entity_ids: [], score, duration: 0,
        questions_json: { ticker, company: data?.company },
      });
      await supabase.from("score_events").insert(
        qs.map((q, idx) => ({ user_id: userId, concept_tag: q.concept, correct: answers[idx] === q.answer, difficulty: "med", source_mode: "single" }))
      );
    } catch { /* non-fatal */ }
    (score / qs.length >= 0.6 ? SFX.win : SFX.wrong)();
    setPhase("result");
  }

  if (phase === "entry") {
    return (
      <div>
        <div className="card" style={{ background: "var(--charcoal)", color: "#fff" }}>
          Pick a company — I&apos;ll pull its latest quarter from SEC EDGAR and turn the numbers into a puzzle.
        </div>
        <label style={{ fontSize: 12, fontWeight: 700, display: "block", margin: "16px 0 4px" }}>Ticker</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase())} placeholder="NEE" maxLength={6}
            onKeyDown={(e) => e.key === "Enter" && analyze()} style={{ fontWeight: 700, letterSpacing: 1, fontFamily: "ui-monospace, monospace" }} />
          <button className="btn" disabled={loading} onClick={() => analyze()}>{loading ? "Pulling…" : "Analyze"}</button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
          {PICKS.map((p) => (
            <button key={p} onClick={() => analyze(p)} style={{ width: "auto", border: "1px solid var(--border)", background: "#fff", color: "var(--red)", fontWeight: 700, fontSize: 12, borderRadius: 18, padding: "4px 11px", cursor: "pointer", fontFamily: "ui-monospace, monospace" }}>{p}</button>
          ))}
        </div>
        {note && <div className="card" style={{ marginTop: 14, background: "#FBF2DD", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13 }}>{note}</div>}
        <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 16 }}>Pulled figures are real SEC filings — verify against the 10-Q. Educational tool, not investment advice.</p>
      </div>
    );
  }

  if (phase === "result") {
    const score = answers.filter((a, idx) => a === qs[idx].answer).length;
    const pct = score / qs.length;
    return (
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: 24 }}>{pct === 1 ? "Flawless! 🏆" : pct >= 0.6 ? "Solid work! 💪" : "Keep practicing!"}</h2>
        <div style={{ fontSize: 38, fontWeight: 800, color: "var(--red)" }}>{score} / {qs.length}</div>
        <p style={{ color: "var(--ink2)" }}>Saved to your account — it feeds your acumen score.</p>
        <button className="btn" onClick={() => { setPhase("entry"); setNote(""); }}>Try another company</button>
      </div>
    );
  }

  // quiz
  const q = qs[qi];
  const summary: [string, number | undefined][] = ([
    ["Revenue", data?.revenue], ["Operating income", data?.operatingIncome], ["Net income", data?.netIncome],
    ["Total assets", data?.totalAssets], ["Total equity", data?.totalEquity], ["Total debt", data?.totalDebt],
    ["Op. cash flow", data?.operatingCashFlow], ["Capex", data?.capex],
  ] as [string, number | undefined][]).filter((r) => r[1] != null);

  return (
    <div>
      <div className="card">
        <h2 style={{ fontSize: 18, margin: 0 }}>{data?.company || "Company"}</h2>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{data?.period} · $ millions</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 14px", marginTop: 8 }}>
          {summary.map((r) => (
            <div key={r[0]} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{r[0]}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{cf$(r[1])}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", color: "#fff", background: CHTAG[q.concept] || "#0572CE", padding: "4px 10px", borderRadius: 5 }}>{q.tag}</span>
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Question {qi + 1} of {qs.length}</span>
        </div>
        <div style={{ fontSize: 16.5, fontWeight: 700, margin: "6px 0 12px" }}>{q.q}</div>

        {FORMULAS[q.tag] && (
          <>
            <button onClick={() => setShowF((f) => !f)} style={{ width: "auto", background: "none", border: "1px solid var(--border)", color: "var(--blue)", fontWeight: 700, fontSize: 12, borderRadius: 16, padding: "5px 12px", cursor: "pointer", marginBottom: 10 }}>
              {showF ? "🧮 Hide formula" : "🧮 Tell me more"}
            </button>
            {showF && <div style={{ fontSize: 13, lineHeight: 1.5, background: "#EEF4FB", borderLeft: "3px solid var(--blue)", borderRadius: 6, padding: "10px 12px", marginBottom: 12 }}>{FORMULAS[q.tag]}</div>}
          </>
        )}

        {q.options.map((o, i) => {
          let bg = "#fff", bd = "var(--border)", col = "var(--ink)";
          if (chosen != null) {
            if (i === q.answer) { bg = "#E8F5EE"; bd = "var(--green)"; col = "#135a34"; }
            else if (i === chosen) { bg = "#F9E7E3"; bd = "var(--red)"; col = "#9B2C1A"; }
          }
          return (
            <button key={i} onClick={() => choose(i)} style={{ display: "block", width: "100%", textAlign: "left", background: bg, border: `1.5px solid ${bd}`, color: col, borderRadius: 9, padding: "12px 14px", marginBottom: 8, fontSize: 14.5, fontWeight: 600, cursor: chosen == null ? "pointer" : "default", opacity: chosen != null && i !== q.answer && i !== chosen ? 0.55 : 1 }}>
              {o.label}
            </button>
          );
        })}

        {chosen != null && (
          <>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, background: "#F7F2E9", borderLeft: "3px solid var(--gold)", borderRadius: 6, padding: "11px 13px", marginTop: 6 }}>{q.ex}</div>
            <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={next}>{qi + 1 < qs.length ? "Next" : "See score"}</button>
          </>
        )}
      </div>
    </div>
  );
}
