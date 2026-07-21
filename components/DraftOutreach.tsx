"use client";
import { useState } from "react";

// "Draft outreach" on a signal card: one grounded, editable email draft. The
// rep reviews, edits, and sends from their own mail client — never auto-sent.
export type Trigger = { kind: string; title: string; detail?: string; date?: string; url?: string };

export default function DraftOutreach({ accountId, trigger }: { accountId: string; trigger: Trigger }) {
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [rcpt, setRcpt] = useState<{ name: string; title: string | null; email: string | null } | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);

  async function generate() {
    setState("loading"); setErr(""); setCopied(false);
    try {
      const r = await fetch("/api/draft-outreach", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, trigger }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.draft) { setErr(j?.error || "Draft failed — try again."); setState("error"); return; }
      setSubject(j.draft.subject); setBody(j.draft.body); setRcpt(j.recipient); setState("done");
    } catch { setErr("Network error."); setState("error"); }
  }
  function copyAll() {
    navigator.clipboard.writeText(`Subject: ${subject}\n\n${body}`).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  const mailto = `mailto:${rcpt?.email ? encodeURIComponent(rcpt.email) : ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (state !== "done") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
        <button onClick={generate} disabled={state === "loading"}
          style={{ background: "none", border: "none", padding: 0, fontSize: 12.5, fontWeight: 700, color: "#6A3E8E", cursor: state === "loading" ? "default" : "pointer" }}>
          ✉️ {state === "loading" ? "Drafting… (~15s)" : "Draft outreach"}
        </button>
        {state === "error" && <span style={{ fontSize: 11.5, color: "var(--red)" }}>{err}</span>}
      </span>
    );
  }

  return (
    <div style={{ marginTop: 8, background: "#F7F3FB", border: "1px solid #DCCDEB", borderRadius: 10, padding: "10px 12px", textAlign: "left" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#6A3E8E" }}>
          ✉️ Draft{rcpt ? ` · to ${rcpt.name}${rcpt.title ? ` (${rcpt.title})` : ""}` : ""}
        </span>
        <button className="mini" onClick={copyAll}>{copied ? "✓ Copied" : "Copy"}</button>
        <a className="mini" href={mailto} style={{ textDecoration: "none" }}>Open in email</a>
        <button className="mini" onClick={generate}>↻</button>
        <button onClick={() => setState("idle")} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
      </div>
      <input value={subject} onChange={(e) => setSubject(e.target.value)}
        style={{ width: "100%", fontSize: 13, fontWeight: 700, marginBottom: 6, border: "1px solid #E2D8EE", borderRadius: 6, padding: "6px 8px", background: "#fff" }} />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={Math.min(12, body.split("\n").length + 3)}
        style={{ width: "100%", fontSize: 13, lineHeight: 1.5, border: "1px solid #E2D8EE", borderRadius: 6, padding: "8px 10px", fontFamily: "inherit", background: "#fff" }} />
      <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 4 }}>Edit before sending — figures come from filings but you own the words.</div>
    </div>
  );
}
