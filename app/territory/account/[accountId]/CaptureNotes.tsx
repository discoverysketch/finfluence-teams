"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Post-call capture: paste rough notes -> AI structures into a clean log entry
// + extracted tasks + stage suggestion -> rep reviews -> one tap saves it all.
type Draft = { kind: "call" | "meeting" | "note"; note: string; tasks: { body: string; due_days: number; keep?: boolean }[]; stage_suggestion: string; stage_reason: string };
const STAGE_LABEL: Record<string, string> = { prospect: "Prospect", discovery: "Discovery", evaluation: "Evaluation", proposal: "Proposal", negotiation: "Negotiation", closed_won: "Won", closed_lost: "Lost" };

export default function CaptureNotes({ accountId, userId, onSaved, onStage }: {
  accountId: string; userId: string;
  onSaved: (rows: any[]) => void; onStage: (s: string) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
}) {
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [applyStage, setApplyStage] = useState(true);
  const [err, setErr] = useState("");

  async function structure() {
    if (raw.trim().length < 10) return;
    setBusy(true); setErr("");
    try {
      const r = await fetch("/api/capture-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, raw }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.draft) { setErr(j?.error || "Couldn't structure the notes."); return; }
      setDraft({ ...j.draft, tasks: (j.draft.tasks ?? []).map((t: any) => ({ ...t, keep: true })) }); // eslint-disable-line @typescript-eslint/no-explicit-any
      setApplyStage(true);
    } catch { setErr("Network error."); }
    finally { setBusy(false); }
  }

  async function saveAll() {
    if (!draft) return;
    setSaving(true); setErr("");
    const rows = [
      { account_id: accountId, user_id: userId, kind: draft.kind, body: draft.note, due_at: null as string | null },
      ...draft.tasks.filter((t) => t.keep).map((t) => ({
        account_id: accountId, user_id: userId, kind: "task", body: t.body,
        due_at: new Date(Date.now() + Math.max(1, t.due_days || 7) * 24 * 3600 * 1000).toISOString(),
      })),
    ];
    const { data, error } = await supabase.from("activities").insert(rows).select("*");
    setSaving(false);
    if (error) { setErr(error.message); return; }
    if (draft.stage_suggestion && applyStage) onStage(draft.stage_suggestion);
    onSaved(data ?? []);
    setDraft(null); setRaw(""); setOpen(false);
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        style={{ background: "#fff", border: "1.5px dashed #C9BFE0", color: "#6A3E8E", borderRadius: 10, padding: "9px 14px", fontSize: 13.5, fontWeight: 700, cursor: "pointer", marginBottom: 8 }}>
        ✨ Capture call notes
      </button>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 10, background: "#F9F7FC", borderColor: "#DCCDEB" }}>
      {!draft ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#6A3E8E" }}>✨ Capture call notes</span>
            <button onClick={() => { setOpen(false); setRaw(""); setErr(""); }} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5}
            placeholder={"Dump your rough notes — shorthand is fine.\ne.g. met w dan h, close takes 12d mostly manual plant acctg, wants primavera-erp overview + capex refs by fri, bring closson next time"}
            style={{ width: "100%", border: "1px solid #E2D8EE", borderRadius: 8, padding: 10, fontSize: 13.5, fontFamily: "inherit", background: "#fff" }} />
          <button className="btn" style={{ marginTop: 8 }} disabled={busy || raw.trim().length < 10} onClick={structure}>
            {busy ? "Structuring…" : "Structure my notes"}
          </button>
          {err && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{err}</p>}
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#6A3E8E" }}>Review before saving</span>
            <button onClick={() => setDraft(null)} style={{ background: "none", border: "none", color: "var(--ink2)", fontSize: 12, cursor: "pointer", textDecoration: "underline" }}>← Edit raw notes</button>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)", marginBottom: 3 }}>{draft.kind === "meeting" ? "🤝 Meeting" : draft.kind === "call" ? "📞 Call" : "📝 Note"} entry</div>
          <textarea value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} rows={Math.min(8, draft.note.split(/(?<=\.)\s/).length + 2)}
            style={{ width: "100%", border: "1px solid #E2D8EE", borderRadius: 8, padding: 10, fontSize: 13.5, fontFamily: "inherit", background: "#fff", marginBottom: 8 }} />
          {draft.tasks.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)", marginBottom: 3 }}>✅ Next steps ({draft.tasks.filter((t) => t.keep).length} to save)</div>
              {draft.tasks.map((t, i) => (
                <label key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", padding: "4px 0", cursor: "pointer" }}>
                  <input type="checkbox" checked={!!t.keep} onChange={() => setDraft({ ...draft, tasks: draft.tasks.map((x, j) => (j === i ? { ...x, keep: !x.keep } : x)) })} style={{ width: 16, height: 16, marginTop: 2 }} />
                  <span style={{ fontSize: 13, flex: 1 }}>{t.body} <span style={{ color: "var(--muted)", fontSize: 11.5 }}>· due in {t.due_days}d</span></span>
                </label>
              ))}
            </div>
          )}
          {draft.stage_suggestion && (
            <label style={{ display: "flex", gap: 8, alignItems: "center", background: "#fff", border: "1px solid #E2D8EE", borderRadius: 8, padding: "8px 10px", marginBottom: 8, cursor: "pointer" }}>
              <input type="checkbox" checked={applyStage} onChange={() => setApplyStage(!applyStage)} style={{ width: 16, height: 16 }} />
              <span style={{ fontSize: 13 }}>Move stage to <b>{STAGE_LABEL[draft.stage_suggestion] || draft.stage_suggestion}</b>{draft.stage_reason ? <span style={{ color: "var(--ink2)" }}> — {draft.stage_reason}</span> : null}</span>
            </label>
          )}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button className="btn" disabled={saving} onClick={saveAll}>{saving ? "Saving…" : "Save to activity log"}</button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Saved notes sharpen your next pre-call brief.</span>
          </div>
          {err && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{err}</p>}
        </>
      )}
    </div>
  );
}
