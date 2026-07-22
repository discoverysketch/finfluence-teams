"use client";
import { useState } from "react";

// "Who makes the decisions?" — web-researched decision locus (local vs
// corporate vs mixed), reviewed by the rep before saving to the shared
// directory. Steers where the sale actually happens.
type Decision = { locus: "local" | "corporate" | "mixed"; parent?: string; note: string; source_url: string; confidence?: string };
const LOCUS: Record<string, { label: string; color: string; icon: string }> = {
  local: { label: "Decides locally", color: "#1B7A47", icon: "🏠" },
  corporate: { label: "Corporate decides", color: "#6A3E8E", icon: "🏢" },
  mixed: { label: "Mixed / depends", color: "#9A6700", icon: "⚖️" },
};

export default function DecisionAuthority({ entityId, initial }: {
  entityId: string;
  initial: { locus: string | null; note: string | null; source: string | null };
}) {
  const [saved, setSaved] = useState(initial);
  const [state, setState] = useState<"idle" | "loading" | "review" | "saving">("idle");
  const [draft, setDraft] = useState<Decision | null>(null);
  const [err, setErr] = useState("");

  async function research() {
    setState("loading"); setErr("");
    try {
      const r = await fetch("/api/research-decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityId, mode: "draft" }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.draft) { setErr(j?.error || "Research failed."); setState("idle"); return; }
      setDraft(j.draft); setState("review");
    } catch { setErr("Network error."); setState("idle"); }
  }
  async function save() {
    if (!draft) return;
    setState("saving"); setErr("");
    try {
      const r = await fetch("/api/research-decision", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityId, mode: "save", decision: { locus: draft.locus, note: draft.note, source_url: draft.source_url } }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { setErr(j?.error || "Save failed."); setState("review"); return; }
      setSaved({ locus: draft.locus, note: draft.note, source: draft.source_url || null });
      setDraft(null); setState("idle");
    } catch { setErr("Network error."); setState("review"); }
  }

  if (state === "review" && draft) {
    return (
      <div className="card" style={{ margin: "8px 0 0", background: "#F7F3FB", borderColor: "#DCCDEB", padding: "10px 12px" }}>
        <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#6A3E8E", marginBottom: 6 }}>
          Review — who decides{draft.confidence ? ` · ${draft.confidence} confidence` : ""}
        </div>
        <select value={draft.locus} onChange={(e) => setDraft({ ...draft, locus: e.target.value as Decision["locus"] })}
          style={{ fontSize: 13, padding: "6px 8px", borderRadius: 8, marginBottom: 6, width: "100%" }}>
          <option value="local">🏠 Decides locally — this company signs</option>
          <option value="corporate">🏢 Corporate decides{draft.parent ? ` — ${draft.parent}` : ""}</option>
          <option value="mixed">⚖️ Mixed — depends on the purchase</option>
        </select>
        <textarea value={draft.note} rows={3} onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          style={{ width: "100%", border: "1px solid #E2D8EE", borderRadius: 8, padding: "8px 10px", fontSize: 13, fontFamily: "inherit", background: "#fff", marginBottom: 6 }} />
        {draft.source_url && <div style={{ fontSize: 11.5, marginBottom: 8 }}><a href={draft.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>source ↗</a></div>}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" disabled={false} onClick={save}>Save</button>
          <button className="mini" onClick={() => { setDraft(null); setState("idle"); }}>Discard</button>
        </div>
        {err && <p style={{ color: "var(--red)", fontSize: 12.5, margin: "6px 0 0" }}>{err}</p>}
      </div>
    );
  }

  const l = saved.locus ? LOCUS[saved.locus] : null;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8, margin: "8px 0 0", flexWrap: "wrap" }}>
      {l ? (
        <>
          <span style={{ background: l.color, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "3px 9px", flexShrink: 0 }}>{l.icon} {l.label}</span>
          <span style={{ fontSize: 12, color: "var(--ink2)", flex: 1, minWidth: 180 }}>
            {saved.note}{saved.source && <> · <a href={saved.source} target="_blank" rel="noreferrer" style={{ color: "var(--blue)" }}>source ↗</a></>}
          </span>
          <button className="mini" onClick={research} disabled={state === "loading"}>{state === "loading" ? "…" : "↻"}</button>
        </>
      ) : (
        <button onClick={research} disabled={state === "loading"}
          style={{ background: "#fff", border: "1.5px dashed #C9BFE0", color: "#6A3E8E", borderRadius: 8, padding: "6px 12px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          {state === "loading" ? "Researching who decides… (~45s)" : "🏛 Who makes the decisions?"}
        </button>
      )}
      {err && state !== "review" && <span style={{ fontSize: 12, color: "var(--red)" }}>{err}</span>}
    </div>
  );
}
