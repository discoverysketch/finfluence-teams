"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cf$, CHTAG, FORMULAS, type Fin, type Question } from "@/lib/challenge";
import { SFX, sparkle, unlockAudio } from "@/lib/sfx";

// The pulse round: same quiz mechanics as Company Challenge, seeded from a
// specific account's freshest facts; emits score_events (source_mode 'pulse').
export default function Pulse({ userId, data, questions }: { userId: string; data: Fin; questions: Question[] }) {
  const supabase = createClient();
  const [qi, setQi] = useState(0);
  const [chosen, setChosen] = useState<number | null>(null);
  const [showF, setShowF] = useState(false);
  const [answers, setAnswers] = useState<number[]>([]);
  const [done, setDone] = useState(false);

  function choose(i: number) {
    if (chosen != null) return;
    unlockAudio(); setChosen(i); setAnswers((a) => [...a, i]);
    if (questions[qi].options[i].ok) { SFX.correct(); if (typeof window !== "undefined") sparkle(window.innerWidth / 2, 220); }
    else SFX.wrong();
  }

  async function next() {
    if (qi + 1 < questions.length) { setQi(qi + 1); setChosen(null); setShowF(false); return; }
    const score = answers.filter((a, i) => a === questions[i].answer).length;
    try {
      await supabase.from("score_events").insert(
        questions.map((q, i) => ({ user_id: userId, concept_tag: q.concept, correct: answers[i] === q.answer, difficulty: "med", source_mode: "pulse" }))
      );
    } catch { /* non-fatal */ }
    (score / questions.length >= 0.6 ? SFX.win : SFX.wrong)();
    setDone(true);
  }

  if (done) {
    const score = answers.filter((a, i) => a === questions[i].answer).length;
    return (
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: 22 }}>{score === questions.length ? "On the pulse! 🫀" : score / questions.length >= 0.6 ? "Solid read! 📈" : "Worth a re-read!"}</h2>
        <div style={{ fontSize: 38, fontWeight: 800, color: "var(--red)" }}>{score} / {questions.length}</div>
        <p style={{ color: "var(--ink2)" }}>Saved — feeds your Acumen and the League.</p>
        <Link href="/challenge/pulse" className="btn" style={{ display: "inline-block" }}>Back to Pulse</Link>
      </div>
    );
  }

  const q = questions[qi];
  const summary: [string, number | undefined][] = ([
    ["Revenue", data.revenue], ["Operating income", data.operatingIncome], ["Net income", data.netIncome],
    ["Total assets", data.totalAssets], ["Total equity", data.totalEquity], ["Total debt", data.totalDebt],
    ["Op. cash flow", data.operatingCashFlow], ["Capex", data.capex],
  ] as [string, number | undefined][]).filter((r) => r[1] != null);

  return (
    <div>
      <div className="card">
        <h2 style={{ fontSize: 18, margin: 0 }}>{data.company}</h2>
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>{data.period} · $ millions</div>
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
          <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Question {qi + 1} of {questions.length}</span>
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
            <button className="btn" style={{ width: "100%", marginTop: 12 }} onClick={next}>{qi + 1 < questions.length ? "Next" : "See score"}</button>
          </>
        )}
      </div>
    </div>
  );
}
