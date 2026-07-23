"use client";
import { useEffect, useRef, useState } from "react";

// Live-meeting companion. Numbers a rep needs at a glance, then a whisper
// loop: capture what the customer said (type or dictate), get a speakable,
// grounded reply with the selling principle and a proof point. Session stays
// on-device; nothing is logged unless the rep captures notes afterward.
type Coach = { answer: string; why: string[]; proof: string };
type Turn = { said: string; coach?: Coach; error?: string };
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`);

export default function MeetingMode({ entityId, company }: { entityId: string; company: string }) {
  const [tiles, setTiles] = useState<{ n: string; l: string }[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const recRef = useRef<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
    setSpeechOk(!!SR);
    (async () => {
      try {
        const r = await fetch(`/api/entity-facts?entityId=${entityId}`);
        const j = await r.json();
        if (!r.ok) return;
        const t: { n: string; l: string }[] = [];
        const f = j.facts ? Object.fromEntries((j.facts as { key: string; value: number }[]).map((x) => [x.key, x.value])) : {};
        if (f.fy_revenue != null) t.push({ n: fmtM(f.fy_revenue), l: "FY revenue" });
        if (f.fy_capex != null) t.push({ n: fmtM(Math.abs(f.fy_capex)), l: "FY capex" });
        if (f.fy_operatingCashFlow != null && f.fy_capex) t.push({ n: `${(f.fy_operatingCashFlow / Math.abs(f.fy_capex)).toFixed(2)}×`, l: "cash flow ÷ capex" });
        if (f.totalDebt != null) t.push({ n: fmtM(f.totalDebt), l: "total debt" });
        if (j.ferc?.facts?.net_utility_plant != null) t.push({ n: fmtM(j.ferc.facts.net_utility_plant), l: "rate base" });
        const hist = j.ferc?.facts ? Object.keys(j.ferc.facts).filter((k: string) => /^net_utility_plant_\d{4}$/.test(k)).sort() : [];
        if (hist.length >= 3) {
          const a = j.ferc.facts[hist[0]], b = j.ferc.facts[hist[hist.length - 1]];
          if (a > 0) t.push({ n: `${((Math.pow(b / a, 1 / (hist.length - 1)) - 1) * 100).toFixed(1)}%/yr`, l: "rate-base growth" });
        }
        if (j.eia?.facts?.customers) t.push({ n: `${Math.round(j.eia.facts.customers / 1000)}k`, l: "customers" });
        setTiles(t.slice(0, 6));
      } catch { /* tiles are optional */ }
    })();
    return () => { try { recRef.current?.stop(); } catch { /* noop */ } };
  }, [entityId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [turns]);

  function toggleMic() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition; // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!SR) return;
    if (listening) { try { recRef.current?.stop(); } catch { /* noop */ } setListening(false); return; }
    const rec = new SR();
    rec.continuous = true; rec.interimResults = false; rec.lang = "en-US";
    rec.onresult = (ev: any) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      let add = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) if (ev.results[i].isFinal) add += ev.results[i][0].transcript + " ";
      if (add) setInput((v) => (v ? v.replace(/\s*$/, " ") : "") + add.trim() + " ");
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec; rec.start(); setListening(true);
  }

  async function coach() {
    const said = input.trim();
    if (!said || busy) return;
    setInput(""); setBusy(true);
    const idx = turns.length;
    setTurns((t) => [...t, { said }]);
    try {
      // History: everything the customer has said + what the coach suggested,
      // as a running meeting transcript for context.
      const messages = [...turns.flatMap((t) => [
        { role: "cfo", content: t.said },
        ...(t.coach ? [{ role: "rep", content: t.coach.answer }] : []),
      ]), { role: "cfo", content: said }];
      const r = await fetch("/api/cfo-sim", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, mode: "coach", live: true, messages }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.coach) {
        setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: j?.error || "Coach unavailable — try again." } : x)));
      } else {
        setTurns((t) => t.map((x, i) => (i === idx ? { ...x, coach: j.coach } : x)));
      }
    } catch {
      setTurns((t) => t.map((x, i) => (i === idx ? { ...x, error: "Network error." } : x)));
    } finally { setBusy(false); }
  }

  return (
    <div>
      {/* Glanceable numbers */}
      {tiles.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6, marginBottom: 12 }}>
          {tiles.map((t) => (
            <div key={t.l} style={{ background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 10px", textAlign: "center" }}>
              <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>{t.n}</div>
              <div style={{ fontSize: 10, color: "var(--ink2)", fontWeight: 700 }}>{t.l}</div>
            </div>
          ))}
        </div>
      )}

      {/* The whisper loop */}
      {turns.length === 0 && (
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 10px" }}>
          When {company.split(" ")[0]} says something you want help with — an objection, a hard question — capture it below and get a speakable answer, silently. Nothing here is saved or visible to the customer.
        </p>
      )}
      {turns.map((t, i) => (
        <div key={i} style={{ marginBottom: 10 }}>
          <div style={{ background: "#F4EFE6", borderRadius: "12px 12px 12px 3px", padding: "9px 12px", fontSize: 13.5, color: "var(--ink)" }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: "#8A7E6E", display: "block", marginBottom: 2 }}>THEY SAID</span>
            {t.said}
          </div>
          {!t.coach && !t.error && <div style={{ fontSize: 12.5, color: "#9A6700", fontWeight: 700, padding: "6px 4px" }}>🎧 thinking…</div>}
          {t.error && <div style={{ fontSize: 12.5, color: "var(--red)", padding: "6px 4px" }}>{t.error}</div>}
          {t.coach && (
            <div style={{ background: "#FAF6EE", border: "1px solid #E6CF94", borderRadius: "12px 12px 3px 12px", padding: "10px 12px", marginTop: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#9A6700", display: "block", marginBottom: 3 }}>SAY THIS</span>
              <div style={{ fontSize: 14, lineHeight: 1.55, fontWeight: 600 }}>{t.coach.answer}</div>
              {t.coach.why?.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  {t.coach.why.map((w, wi) => <div key={wi} style={{ fontSize: 11.5, color: "var(--ink2)", padding: "1px 0 1px 10px", textIndent: -10 }}>· {w}</div>)}
                </div>
              )}
              {t.coach.proof && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 6 }}><b style={{ color: "#006B72" }}>Proof:</b> {t.coach.proof}</div>}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />

      <div style={{ position: "sticky", bottom: 8, background: "var(--cream, #FBF7EF)", paddingTop: 6 }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          placeholder={'What did they just say? e.g. "We just did an SAP evaluation and passed — why would this be different?"'}
          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px", fontSize: 14, fontFamily: "inherit", background: "#fff" }} />
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <button className="btn" style={{ flex: 1 }} disabled={busy || input.trim().length < 4} onClick={coach}>
            {busy ? "Coaching…" : "🎧 Coach me"}
          </button>
          {speechOk && (
            <button type="button" onClick={toggleMic}
              style={{ border: listening ? "2px solid var(--red)" : "1px solid var(--border)", background: listening ? "#FDEEEC" : "#fff", color: listening ? "var(--red)" : "var(--ink2)", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
              {listening ? "⏹" : "🎙️"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
