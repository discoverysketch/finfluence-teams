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
