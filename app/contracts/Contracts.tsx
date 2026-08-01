"use client";
import { useState } from "react";
import { TOPICS, GROUPS, type Topic } from "@/lib/negotiationTopics";

export type Doc = { doc_key: string; title: string; category: string; version_label: string; effective: string; source_url: string; chars: number };
type Citation = { doc_key: string; clause: string; quote: string; doc_title: string; version: string; effective: string; url: string };
type Answer = {
  coverage: "addressed" | "partly_addressed" | "not_addressed";
  answer: string; position: string; citations: Citation[];
  talking_points: string[]; watch_out: string;
  question: string; cached?: boolean;
};

const COVER: Record<string, { label: string; bg: string }> = {
  addressed: { label: "Covered by the standard terms", bg: "#1B7A47" },
  partly_addressed: { label: "Partly covered", bg: "#9A6700" },
  not_addressed: { label: "Not in the standard terms", bg: "#B23A2E" },
};

export default function Contracts({ docs }: { docs: Doc[] }) {
  const [ans, setAns] = useState<Answer | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [openDocs, setOpenDocs] = useState(false);

  async function ask(body: { question?: string; topicKey?: string }, label: string) {
    if (busy) return;
    setBusy(label); setErr(""); setAns(null);
    try {
      const r = await fetch("/api/contract-qa", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.answer) { setErr(j?.error || "Couldn't answer that — try again."); return; }
      setAns(j);
    } catch { setErr("Network error — check your connection and try again."); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <form onSubmit={(e) => { e.preventDefault(); if (q.trim().length > 7) ask({ question: q.trim() }, "free"); }}
        className="card" style={{ padding: "13px 14px", marginBottom: 12 }}>
        <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Ask the contracts anything</label>
        <textarea value={q} onChange={(e) => setQ(e.target.value)} rows={2} disabled={!!busy}
          placeholder="e.g. What happens to our data if we don't renew?"
          style={{ width: "100%", marginTop: 6, padding: "9px 11px", fontSize: 14, borderRadius: 8, border: "1px solid var(--border)", fontFamily: "inherit", resize: "vertical" }} />
        <button className="btn" type="submit" disabled={!!busy || q.trim().length < 8} style={{ marginTop: 8 }}>
          {busy === "free" ? "Reading the clauses…" : "Ask"}
        </button>
      </form>

      {err && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12, fontSize: 13, fontWeight: 600 }}>{err}</div>}

      {ans && (
        <div className="card" style={{ padding: "14px 15px", marginBottom: 14, borderColor: "var(--gold)", borderWidth: 2 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 7 }}>
            <span style={{ background: COVER[ans.coverage]?.bg ?? "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 800, letterSpacing: ".4px", textTransform: "uppercase", borderRadius: 4, padding: "2px 8px" }}>
              {COVER[ans.coverage]?.label ?? ans.coverage}
            </span>
            {ans.cached && <span style={{ fontSize: 10.5, color: "var(--muted)", fontWeight: 700 }}>from cache · free</span>}
          </div>
          <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>{ans.question}</div>
          <div style={{ fontSize: 14, lineHeight: 1.55 }}>{ans.answer}</div>

          <div style={{ marginTop: 10, background: "#F7F2E9", borderRadius: 8, padding: "9px 11px" }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)" }}>Oracle&apos;s default position</div>
            <div style={{ fontSize: 13, lineHeight: 1.5, marginTop: 3 }}>{ans.position}</div>
          </div>

          {ans.talking_points?.length > 0 && (
            <div style={{ marginTop: 11 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 4 }}>What you can say</div>
              {ans.talking_points.map((t, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.5, padding: "2px 0 2px 13px", textIndent: -13 }}>· {t}</div>
              ))}
            </div>
          )}

          {ans.watch_out && (
            <div style={{ marginTop: 11, borderLeft: "3px solid #B23A2E", background: "#FBF0EE", borderRadius: 6, padding: "8px 10px" }}>
              <b style={{ fontSize: 12 }}>Watch out:</b> <span style={{ fontSize: 13 }}>{ans.watch_out}</span>
            </div>
          )}

          {ans.citations?.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 5 }}>The actual clauses</div>
              {ans.citations.map((c, i) => (
                <div key={i} style={{ borderTop: i ? "1px solid #F0EAE0" : "none", padding: "7px 0" }}>
                  <div style={{ fontSize: 12, fontWeight: 800 }}>{c.clause}</div>
                  <div style={{ fontSize: 12.5, fontStyle: "italic", color: "var(--ink2)", margin: "3px 0" }}>&ldquo;{c.quote}&rdquo;</div>
                  <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "var(--blue)", fontWeight: 700 }}>
                    {c.doc_title} · {c.version} ↗
                  </a>
                </div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 11, lineHeight: 1.45 }}>
            Read from Oracle&apos;s published standard terms only. Your customer&apos;s signed agreement and ordering document override all of it — check with Deal Desk or Legal before you commit to anything.
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", margin: "16px 0 8px" }}>
        Common negotiation requests
      </div>
      {GROUPS.map((g) => {
        const items = TOPICS.filter((t: Topic) => t.group === g);
        if (!items.length) return null;
        return (
          <div key={g} style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: "var(--ink2)", marginBottom: 5 }}>{g}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {items.map((t) => (
                <button key={t.key} onClick={() => ask({ topicKey: t.key }, t.key)} disabled={!!busy}
                  style={{
                    border: "1px solid var(--border)", background: busy === t.key ? "var(--cream2)" : "#fff",
                    borderRadius: 8, padding: "7px 11px", fontSize: 12.5, fontWeight: 700,
                    color: "var(--ink2)", cursor: busy ? "default" : "pointer", textAlign: "left",
                  }}>
                  {busy === t.key ? "Reading…" : t.ask}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div style={{ marginTop: 18 }}>
        <button onClick={() => setOpenDocs((v) => !v)}
          style={{ background: "none", border: "none", padding: 0, fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", cursor: "pointer" }}>
          {openDocs ? "▾" : "▸"} What&apos;s loaded · {docs.length} documents
        </button>
        {openDocs && (
          <div className="card" style={{ marginTop: 8, padding: "11px 13px" }}>
            {docs.map((d, i) => (
              <div key={d.doc_key} style={{ borderTop: i ? "1px solid #F0EAE0" : "none", padding: "7px 0" }}>
                <a href={d.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 700, color: "var(--ink)" }}>{d.title} ↗</a>
                <div style={{ fontSize: 11.5, color: "var(--muted)" }}>
                  {d.category} · version {d.version_label}{d.effective && d.effective !== "current" ? ` · effective ${d.effective}` : ""}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 8, lineHeight: 1.45 }}>
              Current versions only. Oracle keeps every superseded version online beside the live one — twelve DPAs, fifteen hosting policies — so these are pinned deliberately and re-fetched when Oracle republishes.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
