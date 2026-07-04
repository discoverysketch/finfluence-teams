"use client";
import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";

type Unit = { id: string; title: string; icon: string | null; order: number };
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
  const [pdfB64, setPdfB64] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");

  const loadUnits = useCallback(async (pid: string) => {
    const { data } = await supabase.from("units").select("id,title,icon,ord:order").eq("pack_id", pid);
    setUnits(((data ?? []) as any[]).map((u) => ({ id: u.id, title: u.title, icon: u.icon, order: u.ord })).sort((a, b) => a.order - b.order));
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

  async function selectUnit(u: Unit) { setSel(u); setEditing(null); await loadCards(u.id); }

  async function addUnit() {
    const title = window.prompt("New unit title:"); if (!title || !packId) return;
    const { error } = await supabase.from("units").insert({ pack_id: packId, title, order: units.length, icon: "📘" });
    if (error) return setMsg(error.message);
    await loadUnits(packId);
  }
  async function renameUnit(u: Unit) {
    const title = window.prompt("Rename unit:", u.title); if (!title || !packId) return;
    await supabase.from("units").update({ title }).eq("id", u.id); await loadUnits(packId);
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
      : await supabase.from("cards").insert({ ...payload, unit_id: sel.id, type: "flashcard", order: cards.length });
    if (res.error) return setMsg(res.error.message);
    setEditing(null); await loadCards(sel.id);
  }
  async function deleteCard(id: string) {
    if (!window.confirm("Delete this card?") || !sel) return;
    await supabase.from("cards").delete().eq("id", id); await loadCards(sel.id);
  }

  const setBody = (k: keyof Body, v: string) =>
    setEditing((e) => (e ? { ...e, body_json: { ...(e.body_json ?? {}), [k]: v } } : e));

  function onFile(f: File | undefined) {
    if (!f) return;
    setMsg("");
    if (f.size > 8 * 1024 * 1024) { setMsg("File is too large — keep it under 8 MB (or paste the text instead)."); return; }
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    if (isPdf) {
      const reader = new FileReader();
      reader.onload = () => { setPdfB64(String(reader.result).split(",")[1] || null); setFileName(f.name); setGenSrc(""); };
      reader.readAsDataURL(f);
    } else {
      const reader = new FileReader();
      reader.onload = () => { setGenSrc(String(reader.result || "")); setPdfB64(null); setFileName(f.name); };
      reader.readAsText(f);
    }
  }
  function clearFile() { setPdfB64(null); setFileName(""); setGenSrc(""); }

  async function generate() {
    if (!sel) return;
    setGenLoading(true); setMsg(""); setDrafts([]);
    try {
      const body = pdfB64
        ? { pdfBase64: pdfB64, pdfName: fileName, unitTitle: sel.title, count: genCount }
        : { source: genSrc, unitTitle: sel.title, count: genCount };
      const r = await fetch("/api/generate-cards", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Generation failed."); return; }
      const raw = (j.cards ?? []) as any[];
      setDrafts(raw.map((c) => ({
        id: "", front: c.front || "", concept_tag: c.concept_tag || null, order: 0,
        body_json: { prompt: c.prompt, whatItIs: c.whatItIs, whyItMatters: c.whyItMatters, link: c.link, utility: c.utility, worked: c.worked },
      })));
    } catch { setMsg("Couldn't reach the generator."); }
    finally { setGenLoading(false); }
  }
  async function approveDraft(idx: number) {
    if (!sel) return;
    const c = drafts[idx];
    const { error } = await supabase.from("cards").insert({
      unit_id: sel.id, type: "flashcard", order: cards.length,
      front: c.front, concept_tag: c.concept_tag || null, body_json: c.body_json,
    });
    if (error) return setMsg(error.message);
    setDrafts((d) => d.filter((_, i) => i !== idx));
    await loadCards(sel.id);
  }
  async function approveAll() {
    if (!sel || !drafts.length) return;
    const rows = drafts.map((c, i) => ({
      unit_id: sel.id, type: "flashcard", order: cards.length + i,
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

      <div className="edsec">Units</div>
      {units.map((u) => (
        <div key={u.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px", outline: sel?.id === u.id ? "2px solid var(--red)" : "none" }}>
          <button onClick={() => selectUnit(u)} style={{ flex: 1, textAlign: "left", background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}>
            {u.icon} {u.title}
          </button>
          <button className="mini" onClick={() => renameUnit(u)}>Rename</button>
          <button className="mini del" onClick={() => deleteUnit(u)}>✕</button>
        </div>
      ))}
      <button className="btn" style={{ marginTop: 6 }} onClick={addUnit}>+ Add unit</button>

      {sel && (
        <div className="card" style={{ marginTop: 24, background: "#FAF6EE", borderColor: "#E6CF94" }}>
          <div className="edsec" style={{ marginTop: 0 }}>✨ Generate cards with AI</div>
          <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 10px" }}>
            Upload a document (or paste text). Claude drafts cards for <b>{sel.title}</b> — you review and approve each before it saves. Nothing is published automatically.
          </p>

          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "#fff", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "12px 16px", fontSize: 13, fontWeight: 700, color: "var(--ink2)" }}>
            📎 Choose a file (PDF, .txt, .md, .csv)
            <input type="file" accept=".pdf,.txt,.md,.csv,.text,application/pdf,text/plain" style={{ display: "none" }}
              onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {fileName && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13 }}>
              <span style={{ background: "#EEF4FB", color: "var(--blue)", borderRadius: 6, padding: "3px 9px", fontWeight: 700 }}>
                {pdfB64 ? "📄" : "📝"} {fileName}
              </span>
              <button className="mini del" onClick={clearFile}>Remove</button>
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".6px", margin: "12px 0 6px" }}>
            {pdfB64 ? "PDF attached — or paste text instead" : "or paste text"}
          </div>
          <textarea value={genSrc} onChange={(e) => { setGenSrc(e.target.value); if (pdfB64) { setPdfB64(null); setFileName(""); } }} rows={4} placeholder="Paste the source text here…"
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 13 }} />
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: "var(--ink2)" }}>Cards:
              <select value={genCount} onChange={(e) => setGenCount(Number(e.target.value))} style={{ width: "auto", marginLeft: 6, padding: "4px 8px" }}>
                {[3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button className="btn" disabled={genLoading || (!pdfB64 && genSrc.trim().length < 40)} onClick={generate}>
              {genLoading ? "Drafting…" : "Draft cards"}
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
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{d.front} {d.concept_tag && <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: "var(--blue)", borderRadius: 4, padding: "1px 6px", verticalAlign: "middle" }}>{d.concept_tag}</span>}</div>
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

      {sel && (
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
