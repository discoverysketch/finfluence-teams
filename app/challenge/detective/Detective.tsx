"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SFX, sparkle, unlockAudio } from "@/lib/sfx";

// Metric Detective (SPEC 6d): anonymized financials from the rep's own book →
// guess which account it is. Reuses the entity-facts cache; no LLM cost.
type Item = { accountId: string; entityId: string; name: string; ticker: string | null; facts: Record<string, number>; period: string | null };
type Round = { target: Item; options: Item[] };

const SHOW: [string, string][] = [
  ["revenue", "Revenue"], ["netIncome", "Net income"], ["totalAssets", "Total assets"],
  ["totalDebt", "Total debt"], ["operatingCashFlow", "Op. cash flow"], ["capex", "Capex"],
];
const fmtM = (v?: number) => (v == null ? "—" : `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(1) + "B" : Math.round(Math.abs(v)) + "M"}`);
const shuffle = <T,>(a: T[]) => { const x = a.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; };

export default function Detective({ userId }: { userId: string }) {
  const supabase = createClient();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [eligible, setEligible] = useState<Item[]>([]);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [ri, setRi] = useState(0);
  const [chosen, setChosen] = useState<string | null>(null);
  const [hits, setHits] = useState(0);
  const [results, setResults] = useState<boolean[]>([]);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/territory-facts");
        const j = await r.json();
        const items = ((j.items ?? []) as Item[]).filter((i) => SHOW.filter(([k]) => i.facts[k] != null).length >= 4);
        setEligible(items);
        if (items.length >= 4) buildRounds(items);
      } catch { setErr("Couldn't load your accounts."); }
      finally { setLoading(false); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildRounds(items: Item[]) {
    const targets = shuffle(items).slice(0, Math.min(5, items.length));
    setRounds(targets.map((target) => ({
      target,
      options: shuffle([target, ...shuffle(items.filter((i) => i.entityId !== target.entityId)).slice(0, 3)]),
    })));
    setRi(0); setChosen(null); setHits(0); setResults([]); setDone(false);
  }

  function choose(id: string) {
    if (chosen != null) return;
    unlockAudio(); setChosen(id);
    const right = id === rounds[ri].target.entityId;
    setResults((r) => [...r, right]);
    if (right) {
      setHits((h) => h + 1); SFX.correct();
      if (typeof window !== "undefined") sparkle(window.innerWidth / 2, 220);
    } else SFX.wrong();
  }

  async function next() {
    if (ri + 1 < rounds.length) { setRi(ri + 1); setChosen(null); return; }
    setDone(true);
    (hits / rounds.length >= 0.6 ? SFX.win : SFX.wrong)();
    try {
      await supabase.from("score_events").insert(
        results.map((correct) => ({ user_id: userId, concept_tag: "found", correct, difficulty: "med", source_mode: "detective" }))
      );
    } catch { /* non-fatal */ }
  }

  if (loading) return <div className="card">Loading your book… (first run pulls SEC data)</div>;
  if (err) return <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)" }}>{err}</div>;
  if (eligible.length < 4) {
    return (
      <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13.5 }}>
        Metric Detective needs at least <b>4 accounts with SEC financials</b> in your book (you have {eligible.length}).{" "}
        <Link href="/territory">Add more accounts →</Link>
      </div>
    );
  }

  if (done) {
    return (
      <div style={{ textAlign: "center" }}>
        <h2 style={{ fontSize: 22 }}>{hits === rounds.length ? "Perfect detective! 🕵️" : hits / rounds.length >= 0.6 ? "Sharp eye! 🔎" : "Keep studying your book!"}</h2>
        <div style={{ fontSize: 38, fontWeight: 800, color: "var(--red)" }}>{hits} / {rounds.length}</div>
        <p style={{ color: "var(--ink2)" }}>Saved to your account — it feeds your Acumen and the League.</p>
        <button className="btn" onClick={() => buildRounds(eligible)}>Play again</button>
      </div>
    );
  }

  const round = rounds[ri];
  const factRows = SHOW.filter(([k]) => round.target.facts[k] != null);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>🕵️ Mystery account</span>
        <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>Round {ri + 1} of {rounds.length} · {hits} right</span>
      </div>

      <div className="card">
        <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>{round.target.period?.replace(" · SEC EDGAR", "")} · $ millions · SEC EDGAR</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 16px" }}>
          {factRows.map(([k, label]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
              <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{label}</span>
              <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtM(round.target.facts[k])}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 12 }}>
        <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 10 }}>Which of your accounts is this?</div>
        {round.options.map((o) => {
          let bg = "#fff", bd = "var(--border)", col = "var(--ink)";
          if (chosen != null) {
            if (o.entityId === round.target.entityId) { bg = "#E8F5EE"; bd = "var(--green)"; col = "#135a34"; }
            else if (o.entityId === chosen) { bg = "#F9E7E3"; bd = "var(--red)"; col = "#9B2C1A"; }
          }
          return (
            <button key={o.entityId} onClick={() => choose(o.entityId)} disabled={chosen != null}
              style={{ display: "block", width: "100%", textAlign: "left", background: bg, border: `1.5px solid ${bd}`, color: col, borderRadius: 9, padding: "12px 14px", marginBottom: 8, fontSize: 14.5, fontWeight: 600, cursor: chosen == null ? "pointer" : "default" }}>
              {o.name}{o.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {o.ticker}</span> : null}
            </button>
          );
        })}
        {chosen != null && (
          <button className="btn" style={{ width: "100%", marginTop: 8 }} onClick={next}>
            {ri + 1 < rounds.length ? "Next mystery" : "See score"}
          </button>
        )}
      </div>
    </div>
  );
}
