"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Unit = { id: string; title: string; icon: string | null; order: number; is_seeded: boolean };
type Body = {
  prompt?: string; whatItIs?: string; whyItMatters?: string;
  link?: string; utility?: string; worked?: string;
};
type Card = { id: string; front: string; concept_tag: string | null; body_json: Body | null; order: number };

/* eslint-disable @typescript-eslint/no-explicit-any */
export default function ContentEditor() {
  const supabase = createClient();
  const [packId, setPackId] = useState<string | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [sel, setSel] = useState<Unit | null>(null);
  const [cards, setCards] = useState<Card[]>([]);
  const [editing, setEditing] = useState<Card | null>(null);
  const [msg, setMsg] = useState("");
  const [genSrc, setGenSrc] = useState("");
  const [genCount, setGenCount] = useState(5);
  const [genLoading, setGenLoading] = useState(false);
  const [drafts, setDrafts] = useState<Card[]>([]);
  // Multiple files per batch, mixed types: PDFs upload to Storage and go to
  // Claude natively by path (inline base64 dies at Vercel's ~4.5MB body cap);
  // Word/text files are extracted client-side and joined into the source text.
  const [genFiles, setGenFiles] = useState<{ name: string; kind: "pdf" | "text"; file?: File; text?: string }[]>([]);
  const [proofTopic, setProofTopic] = useState("");
  const [proofLoading, setProofLoading] = useState(false);

  const core = units.filter((u) => u.is_seeded);
  const custom = units.filter((u) => !u.is_seeded);

  const loadUnits = useCallback(async (pid: string) => {
    const { data } = await supabase.from("units").select("id,title,icon,ord:order,is_seeded").eq("pack_id", pid);
    setUnits(((data ?? []) as any[]).map((u) => ({ id: u.id, title: u.title, icon: u.icon, order: u.ord, is_seeded: u.is_seeded })).sort((a, b) => a.order - b.order));
  }, [supabase]);

  const loadCards = useCallback(async (unitId: string) => {
    const { data } = await supabase.from("cards").select("id,front,concept_tag,body_json,ord:order").eq("unit_id", unitId);
    setCards(((data ?? []) as any[]).map((c) => ({ id: c.id, front: c.front, concept_tag: c.concept_tag, body_json: c.body_json, order: c.ord })).sort((a, b) => a.order - b.order));
  }, [supabase]);

  useEffect(() => {
    (async () => {
      const { data: pack } = await supabase.from("content_packs").select("id").eq("is_default", true).maybeSingle();
      if (pack) { setPackId(pack.id); await loadUnits(pack.id); }
    })();
  }, [supabase, loadUnits]);

  async function selectUnit(u: Unit) { setSel(u); setEditing(null); setDrafts([]); clearFile(); await loadCards(u.id); }

  async function addConcept() {
    const title = window.prompt("Name your concept (e.g. “Our Q3 pricing story”):"); if (!title || !packId) return;
    const { data, error } = await supabase.from("units").insert({ pack_id: packId, title, order: units.length, icon: "⭐", is_seeded: false }).select("id,title,icon,ord:order,is_seeded").single();
    if (error) return setMsg(error.message);
    await loadUnits(packId);
    if (data) await selectUnit({ id: data.id, title: data.title, icon: data.icon, order: (data as any).ord, is_seeded: data.is_seeded });
  }
  async function renameUnit(u: Unit) {
    const title = window.prompt("Rename concept:", u.title); if (!title || !packId) return;
    await supabase.from("units").update({ title }).eq("id", u.id); await loadUnits(packId);
    if (sel?.id === u.id) setSel({ ...sel, title });
  }
  async function deleteUnit(u: Unit) {
    if (!window.confirm(`Delete "${u.title}" and all its cards?`) || !packId) return;
    await supabase.from("units").delete().eq("id", u.id);
    if (sel?.id === u.id) { setSel(null); setCards([]); }
    await loadUnits(packId);
  }
  async function saveCard(c: Card) {
    if (!sel) return;
    const payload = { front: c.front, concept_tag: c.concept_tag || null, body_json: c.body_json };
    const res = c.id
      ? await supabase.from("cards").update(payload).eq("id", c.id)
      : await supabase.from("cards").insert({ ...payload, unit_id: sel.id, type: "flashcard", order: cards.length, is_seeded: false });
    if (res.error) return setMsg(res.error.message);
    setEditing(null); await loadCards(sel.id);
  }
  async function deleteCard(id: string) {
    if (!window.confirm("Delete this card?") || !sel) return;
    await supabase.from("cards").delete().eq("id", id); await loadCards(sel.id);
  }

  const setBody = (k: keyof Body, v: string) =>
    setEditing((e) => (e ? { ...e, body_json: { ...(e.body_json ?? {}), [k]: v } } : e));

  const readAsText = (f: File) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = rej; r.readAsText(f); });

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setMsg("");
    const errs: string[] = [];
    for (const f of Array.from(list)) {
      const name = f.name.toLowerCase();
      if (genFiles.some((g) => g.name === f.name)) continue; // already attached
      const isPdf = f.type === "application/pdf" || name.endsWith(".pdf");
      const isDocx = name.endsWith(".docx");
      if (!isPdf && f.size > 8 * 1024 * 1024) { errs.push(`${f.name}: over 8 MB, skipped`); continue; }
      if (isPdf && f.size > 20 * 1024 * 1024) { errs.push(`${f.name}: over 20 MB, skipped`); continue; }
      if (name.endsWith(".doc") && !isDocx) { errs.push(`${f.name}: old .doc format — save as .docx or PDF`); continue; }
      try {
        if (isPdf) {
          if (genFiles.filter((g) => g.kind === "pdf").length >= 4) { errs.push(`${f.name}: max 4 PDFs per batch`); continue; }
          setGenFiles((gs) => [...gs, { name: f.name, kind: "pdf", file: f }]);
        } else if (isDocx) {
          const mod = await import("mammoth/mammoth.browser");
          const mammoth = (mod as { default?: unknown }).default ?? mod;
          const arrayBuffer = await f.arrayBuffer();
          const { value } = await (mammoth as { extractRawText: (o: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> }).extractRawText({ arrayBuffer });
          if (!value.trim()) { errs.push(`${f.name}: no readable text`); continue; }
          setGenFiles((gs) => [...gs, { name: f.name, kind: "text", text: value }]);
        } else {
          const text = await readAsText(f);
          if (text.trim()) setGenFiles((gs) => [...gs, { name: f.name, kind: "text", text }]);
        }
      } catch { errs.push(`${f.name}: couldn't read`); }
    }
    if (errs.length) setMsg(errs.join(" · "));
  }
  function removeFile(name: string) { setGenFiles((gs) => gs.filter((g) => g.name !== name)); }
  function clearFile() { setGenFiles([]); }

  const combinedSource = () => {
    const parts = genFiles.filter((g) => g.kind === "text").map((g) => `--- FILE: ${g.name} ---\n${g.text}`);
    if (genSrc.trim()) parts.push(genSrc.trim());
    return parts.join("\n\n");
  };
  const hasSource = () => genFiles.some((g) => g.kind === "pdf") || combinedSource().length >= 40;

  async function generate() {
    if (!sel) return;
    setGenLoading(true); setMsg(""); setDrafts([]);
    try {
      // PDFs go to Storage first (Vercel's ~4.5MB body cap kills inline base64);
      // only the paths travel in the request.
      const pdfFiles = genFiles.filter((g) => g.kind === "pdf" && g.file);
      const pdfPaths: string[] = [];
      if (pdfFiles.length) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) { setMsg("Session expired — reload and sign in again."); return; }
        for (const g of pdfFiles) {
          const path = `${user.id}/${crypto.randomUUID()}-${g.name.replace(/[^\w.-]/g, "_").slice(-80)}`;
          const { error } = await supabase.storage.from("uploads").upload(path, g.file!, { contentType: "application/pdf" });
          if (error) { setMsg(`Couldn't upload ${g.name}: ${error.message}${/security|policy|not found/i.test(error.message) ? " — the storage migration (0015) may not be applied yet." : ""}`); return; }
          pdfPaths.push(path);
        }
      }
      const body = {
        pdfPaths,
        source: combinedSource(),
        unitTitle: sel.title, count: genCount,
      };
      const r = await fetch("/api/generate-cards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      let j: any = null;
      try { j = await r.json(); } catch { /* non-JSON (e.g. gateway timeout page) */ }
      if (!j) {
        setMsg(`The generator returned ${r.status || "no response"} without a result — big batches (large PDFs or 20+ cards) can exceed the 5-minute server limit. Try fewer cards or smaller files.`);
        return;
      }
      if (!r.ok) { setMsg(j.error || "Generation failed."); return; }
      if (j.note) setMsg(j.note);
      const raw = (j.cards ?? []) as any[];
      setDrafts(raw.map((c) => ({
        id: "", front: c.front || "", concept_tag: c.concept_tag || null, order: 0,
        body_json: { prompt: c.prompt, whatItIs: c.whatItIs, whyItMatters: c.whyItMatters, link: c.link, utility: c.utility, worked: c.worked },
      })));
    } catch { setMsg("Couldn't reach the generator — the connection dropped (very large batches can exceed the 5-minute server limit) or you're offline. Try again with fewer cards or smaller files."); }
    finally { setGenLoading(false); }
  }
  async function researchProofs() {
    if (!sel) return;
    setProofLoading(true); setMsg(""); setDrafts([]);
    try {
      const r = await fetch("/api/research-proofs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: proofTopic, count: 5 }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Research failed."); return; }
      const raw = (j.cards ?? []) as any[];
      setDrafts(raw.map((c) => ({
        id: "", front: c.front || "", concept_tag: c.concept_tag || null, order: 0,
        body_json: { prompt: c.prompt, whatItIs: c.whatItIs, whyItMatters: c.whyItMatters, link: c.link, utility: c.utility, worked: c.worked },
      })));
    } catch { setMsg("Couldn't reach the researcher."); }
    finally { setProofLoading(false); }
  }

  async function approveDraft(idx: number) {
    if (!sel) return;
    const c = drafts[idx];
    const { error } = await supabase.from("cards").insert({
      unit_id: sel.id, type: "flashcard", order: cards.length, is_seeded: false,
      front: c.front, concept_tag: c.concept_tag || null, body_json: c.body_json,
    });
    if (error) return setMsg(error.message);
    setDrafts((d) => d.filter((_, i) => i !== idx));
    await loadCards(sel.id);
  }
  async function approveAll() {
    if (!sel || !drafts.length) return;
    const rows = drafts.map((c, i) => ({
      unit_id: sel.id, type: "flashcard", order: cards.length + i, is_seeded: false,
      front: c.front, concept_tag: c.concept_tag || null, body_json: c.body_json,
    }));
    const { error } = await supabase.from("cards").insert(rows);
    if (error) return setMsg(error.message);
    setDrafts([]); await loadCards(sel.id);
  }
  function editDraft(idx: number) { setEditing(drafts[idx]); setDrafts((d) => d.filter((_, i) => i !== idx)); }

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}

      {/* ---------- Core curriculum: locked reference ---------- */}
      <div className="edsec">Core curriculum · 🔒 built-in</div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
        The shipped FinFluency curriculum. It powers Acumen scores and the manager dashboard, so it isn&apos;t editable here.
      </p>
      {core.map((u) => (
        <div key={u.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px", background: "#F7F4EE" }}>
          <div style={{ flex: 1, fontWeight: 700, color: "var(--ink2)" }}>{u.icon} {u.title}</div>
          <span style={{ fontSize: 10, fontWeight: 700, color: "#8A7E6E", background: "#EDE7DA", borderRadius: 5, padding: "3px 8px" }}>🔒 Built-in</span>
        </div>
      ))}

      {/* ---------- Custom concepts: the editable area ---------- */}
      <div className="edsec" style={{ marginTop: 26 }}>Your concepts</div>
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
        Add your own topics and cards — pricing stories, product notes, objection handling, anything. They appear in the learning path as <b>practice</b> (they don&apos;t affect Acumen scores).
      </p>
      {custom.length === 0 && (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13 }}>
          No custom concepts yet. Create one below, then add cards by hand or generate them from a document with AI.
        </div>
      )}
      {custom.map((u) => (
        <div key={u.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px", outline: sel?.id === u.id ? "2px solid var(--red)" : "none" }}>
          <button onClick={() => selectUnit(u)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
            {u.icon} {u.title}
          </button>
          <button className="mini" onClick={() => renameUnit(u)}>Rename</button>
          <button className="mini del" onClick={() => deleteUnit(u)}>✕</button>
        </div>
      ))}
      <button className="btn" style={{ marginTop: 6 }} onClick={addConcept}>+ New concept</button>

      {sel && !sel.is_seeded && (
        <div className="card" style={{ marginTop: 24, background: "#FAF6EE", borderColor: "#E6CF94" }}>
          <div className="edsec" style={{ marginTop: 0 }}>✨ Generate cards with AI</div>
          <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>
            Upload one or more documents (mix PDFs, Word, text) and/or paste text. Claude drafts cards for <b>{sel.title}</b> from all of it — you review and approve each before it saves. Nothing is published automatically.
          </p>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "#fff", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>
            📎 Choose files (PDF, Word, .txt, .md, .csv — several at once)
            <input type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,.text,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document" style={{ display: "none" }}
              onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
          </label>
          {genFiles.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 13, flexWrap: "wrap" }}>
              {genFiles.map((g) => (
                <span key={g.name} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#EEF4FB", color: "var(--blue)", borderRadius: 6, padding: "3px 9px", fontWeight: 700 }}>
                  {g.kind === "pdf" ? "📄" : "📝"} {g.name}
                  <button aria-label={`Remove ${g.name}`} onClick={() => removeFile(g.name)} style={{ background: "none", border: "none", color: "var(--red)", cursor: "pointer", fontWeight: 800, padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                </span>
              ))}
              {genFiles.length > 1 && <button className="mini del" onClick={clearFile}>Clear all</button>}
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", margin: "12px 0 6px" }}>
            {genFiles.length ? "and / or paste text" : "or paste text"}
          </div>
          <textarea value={genSrc} onChange={(e) => setGenSrc(e.target.value)} rows={4} placeholder="Paste the source text here…"
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 13 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Cards:
              <select value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} style={{ width: "auto", marginLeft: 6, padding: "4px 8px" }}>
                {[3, 5, 8, 10, 12, 15, 20, 25].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="btn" disabled={genLoading || !hasSource()} onClick={generate}>
              {genLoading ? `Drafting ${genCount}… (bigger batches take longer)` : "Draft cards"}
            </button>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", margin: "14px 0 6px" }}>
            or harvest real proof points from the web
          </div>
          <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
            Searches for <b>utility / energy / water</b> customer stories (oracle.com case studies, press releases) and drafts them as cards — every one carries its source URL. You still approve each.
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input value={proofTopic} onChange={(e) => setProofTopic(e.target.value)} placeholder="Focus (optional) — e.g. Primavera capital projects, EPM close"
              style={{ flex: 1, minWidth: 200 }} disabled={proofLoading} />
            <button className="btn" style={{ background: "var(--teal)" }} disabled={proofLoading || genLoading} onClick={researchProofs}>
              {proofLoading ? "Searching the web… (~1–2 min)" : "🔎 Research proof points"}
            </button>
          </div>

          {drafts.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div className="edsec" style={{ margin: 0 }}>{drafts.length} draft{drafts.length === 1 ? "" : "s"} — review before saving</div>
                <button className="mini" style={{ borderColor: "var(--green)", color: "#135a34" }} onClick={approveAll}>✓ Approve all</button>
              </div>
              {drafts.map((d, i) => (
                <div key={i} className="card" style={{ marginTop: 8, padding: "10px 12px", background: "#fff" }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.front}</div>
                  {d.body_json?.whatItIs && <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 3 }}>{d.body_json.whatItIs}</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button className="mini" style={{ borderColor: "var(--green)", color: "#135a34" }} onClick={() => approveDraft(i)}>✓ Save</button>
                    <button className="mini" onClick={() => editDraft(i)}>Edit first</button>
                    <button className="mini del" onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>Discard</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sel && !sel.is_seeded && (
        <div style={{ marginTop: 24 }}>
          <div className="edsec">Cards in “{sel.title}”</div>
          {cards.map((c) => (
            <div key={c.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px" }}>
              <div style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>{c.front}</div>
              <button className="mini" onClick={() => setEditing(c)}>Edit</button>
              <button className="mini del" onClick={() => deleteCard(c.id)}>✕</button>
            </div>
          ))}
          <button className="btn" style={{ marginTop: 6 }} onClick={() => setEditing({ id: "", front: "", concept_tag: null, body_json: {}, order: cards.length })}>+ Add card</button>
        </div>
      )}

      {editing && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="edsec">{editing.id ? "Edit card" : "New card"}</div>
          <Field label="Term (front)" v={editing.front} onChange={(v) => setEditing({ ...editing, front: v })} />
          <Field label="Concept tag (optional, e.g. rate_base)" v={editing.concept_tag ?? ""} onChange={(v) => setEditing({ ...editing, concept_tag: v })} />
          <Field label="Prompt (question on the front)" v={editing.body_json?.prompt ?? ""} onChange={(v) => setBody("prompt", v)} ta />
          <Field label="What it is" v={editing.body_json?.whatItIs ?? ""} onChange={(v) => setBody("whatItIs", v)} ta />
          <Field label="Why it matters" v={editing.body_json?.whyItMatters ?? ""} onChange={(v) => setBody("whyItMatters", v)} ta />
          <Field label="Link / connection" v={editing.body_json?.link ?? ""} onChange={(v) => setBody("link", v)} ta />
          <Field label="Utility lens (optional)" v={editing.body_json?.utility ?? ""} onChange={(v) => setBody("utility", v)} ta />
          <Field label="Worked example (optional)" v={editing.body_json?.worked ?? ""} onChange={(v) => setBody("worked", v)} ta />
          <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
            <button className="btn" onClick={() => saveCard(editing)}>Save</button>
            <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <style>{`
        .edsec{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:12px 0 8px}
        .mini{border:1px solid var(--border);background:#fff;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer}
        .mini.del{color:var(--red)}
      `}</style>
    </div>
  );
}

function Field({ label, v, onChange, ta }: { label: string; v: string; onChange: (v: string) => void; ta?: boolean }) {
  return (
    <label style={{ display: "block", marginBottom: 10 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)" }}>{label}</span>
      {ta ? (
        <textarea value={v} onChange={(e) => onChange(e.target.value)} rows={2} style={{ width: "100%", marginTop: 4, border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 14 }} />
      ) : (
        <input value={v} onChange={(e) => onChange(e.target.value)} style={{ marginTop: 4 }} />
      )}
    </label>
  );
}
