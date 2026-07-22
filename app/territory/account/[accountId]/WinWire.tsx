"use client";
import { useState } from "react";

// Closed won -> capture the win. AI drafts the story from the account's data
// and the rep's own deal log; the rep edits, then it saves into the "Team Win
// Wires" content unit — feeding the Path, the CFO coach, and future proofs.
type Draft = { front: string; whatItIs: string; worked: string; utility: string };

export default function WinWire({ accountId }: { accountId: string }) {
  const [state, setState] = useState<"idle" | "loading" | "review" | "saving" | "saved" | "error">("idle");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [err, setErr] = useState("");

  async function generate() {
    setState("loading"); setErr("");
    try {
      const r = await fetch("/api/win-wire", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, mode: "draft" }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.draft) { setErr(j?.error || "Draft failed."); setState("error"); return; }
      setDraft(j.draft); setState("review");
    } catch { setErr("Network error."); setState("error"); }
  }
  async function save() {
    if (!draft) return;
    setState("saving"); setErr("");
    try {
      const r = await fetch("/api/win-wire", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "save", card: { front: draft.front, body_json: { whatItIs: draft.whatItIs, worked: draft.worked, utility: draft.utility } } }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.ok) { setErr(j?.error || "Save failed."); setState("review"); return; }
      setState("saved");
    } catch { setErr("Network error."); setState("review"); }
  }

  if (state === "saved") {
    return (
      <div className="card" style={{ margin: "12px 0 2px", background: "#F1F8F3", borderColor: "#BFDCC9", fontSize: 13.5 }}>
        🏆 Win wire saved to <b>Team Win Wires</b> — it now shows on the Path and powers the CFO coach&apos;s answers.
      </div>
    );
  }

  if (state === "idle" || state === "loading" || state === "error") {
    return (
      <div className="card" style={{ margin: "12px 0 2px", background: "#FAF6EE", borderColor: "#E6CF94" }}>
        <div style={{ fontSize: 14, fontWeight: 800, marginBottom: 4 }}>🏆 Closed won — capture the win</div>
        <div style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
          Turn this deal into a win wire the whole team learns from. Drafted from your notes and the account&apos;s real figures; you review before anything saves.
        </div>
        <button className="btn" disabled={state === "loading"} onClick={generate}>
          {state === "loading" ? "Drafting from your deal log… (~20s)" : "Draft the win wire"}
        </button>
        {state === "error" && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{err}</p>}
      </div>
    );
  }

  const Field = ({ label, k, rows }: { label: string; k: keyof Draft; rows: number }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "#9A6700", marginBottom: 3 }}>{label}</div>
      <textarea value={draft![k]} rows={rows} onChange={(e) => setDraft({ ...draft!, [k]: e.target.value })}
        style={{ width: "100%", border: "1px solid #E8DFC9", borderRadius: 8, padding: "8px 10px", fontSize: 13, lineHeight: 1.5, fontFamily: "inherit", background: "#fff" }} />
    </div>
  );

  return (
    <div className="card" style={{ margin: "12px 0 2px", background: "#FAF6EE", borderColor: "#E6CF94" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ flex: 1, fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "#9A6700" }}>🏆 Review the win wire</span>
        <button className="mini" onClick={generate}>↻</button>
        <button onClick={() => { setDraft(null); setState("idle"); }} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
      </div>
      <Field label="Title" k="front" rows={1} />
      <Field label="The customer & the win" k="whatItIs" rows={2} />
      <Field label="The story" k="worked" rows={5} />
      <Field label="How to use this win" k="utility" rows={2} />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button className="btn" disabled={state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save to Team Win Wires"}</button>
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Lands in the content pack — Path + CFO coach.</span>
      </div>
      {err && <p style={{ color: "var(--red)", fontSize: 13, margin: "8px 0 0" }}>{err}</p>}
    </div>
  );
}
