"use client";
import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export type Contact = { id: string; account_id: string; name: string; title: string | null; role_tag: string | null; email: string | null; phone: string | null; reports_to: string | null; notes: string | null };
export type Activity = { id: string; account_id: string; contact_id: string | null; user_id: string | null; kind: string; body: string; due_at: string | null; done: boolean; created_at: string };

const STAGES: [string, string][] = [
  ["prospect", "Prospect"], ["discovery", "Discovery"], ["evaluation", "Evaluation"],
  ["proposal", "Proposal"], ["negotiation", "Negotiation"], ["closed_won", "Won"], ["closed_lost", "Lost"],
];
const ROLES: Record<string, { label: string; color: string }> = {
  economic_buyer: { label: "Economic buyer", color: "#9A6700" },
  champion: { label: "Champion", color: "#1B7A47" },
  exec_sponsor: { label: "Exec sponsor", color: "#6A3E8E" },
  influencer: { label: "Influencer", color: "#0572CE" },
  end_user: { label: "User", color: "#8A7E6E" },
  blocker: { label: "Blocker", color: "#B23A2E" },
};
const KIND_ICON: Record<string, string> = { note: "📝", call: "📞", meeting: "🤝", email: "✉️", task: "✅" };
const fmtWhen = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric" }) + " " + new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
const fmtDue = (s: string) => new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

type CForm = { id?: string; name: string; title: string; role_tag: string; email: string; phone: string; reports_to: string };
const emptyC: CForm = { name: "", title: "", role_tag: "", email: "", phone: "", reports_to: "" };

export default function Hub({ accountId, userId, initialStage, initialNotes, initialContacts, initialActivities, emailOf }: {
  accountId: string; userId: string; initialStage: string | null; initialNotes: string | null;
  initialContacts: Contact[]; initialActivities: Activity[]; emailOf: Record<string, string>;
}) {
  const supabase = createClient();
  const [stage, setStage] = useState(initialStage || "prospect");
  const [notes, setNotes] = useState(initialNotes || "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [acts, setActs] = useState<Activity[]>(initialActivities);
  const [msg, setMsg] = useState("");
  const [cForm, setCForm] = useState<CForm | null>(null);
  const [aKind, setAKind] = useState("note");
  const [aBody, setABody] = useState("");
  const [aDue, setADue] = useState("");
  const [aContact, setAContact] = useState("");

  const contactName = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c.name])), [contacts]);

  async function saveStage(s: string) {
    setStage(s);
    const { error } = await supabase.from("accounts").update({ crm_stage: s }).eq("id", accountId);
    if (error) setMsg(error.message);
  }
  async function saveNotes() {
    const { error } = await supabase.from("accounts").update({ rep_notes: notes }).eq("id", accountId);
    if (error) setMsg(error.message); else setNotesDirty(false);
  }

  // ---- contacts ----
  async function saveContact() {
    if (!cForm || cForm.name.trim().length < 2) return;
    const payload = {
      account_id: accountId, name: cForm.name.trim(), title: cForm.title.trim() || null,
      role_tag: cForm.role_tag || null, email: cForm.email.trim() || null, phone: cForm.phone.trim() || null,
      reports_to: cForm.reports_to || null,
    };
    if (cForm.id) {
      const { error } = await supabase.from("contacts").update(payload).eq("id", cForm.id);
      if (error) return setMsg(error.message);
      setContacts((cs) => cs.map((c) => (c.id === cForm.id ? { ...c, ...payload } as Contact : c)));
    } else {
      const { data, error } = await supabase.from("contacts").insert(payload).select("*").single();
      if (error || !data) return setMsg(error?.message || "Save failed");
      setContacts((cs) => [...cs, data as Contact]);
    }
    setCForm(null);
  }
  async function deleteContact(id: string) {
    if (!window.confirm("Remove this person?")) return;
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) return setMsg(error.message);
    setContacts((cs) => cs.filter((c) => c.id !== id).map((c) => (c.reports_to === id ? { ...c, reports_to: null } : c)));
  }

  // ---- activities ----
  async function addActivity() {
    const body = aBody.trim();
    if (!body) return;
    const payload = {
      account_id: accountId, user_id: userId, kind: aKind, body,
      contact_id: aContact || null,
      due_at: aKind === "task" && aDue ? new Date(aDue + "T12:00:00").toISOString() : null,
    };
    const { data, error } = await supabase.from("activities").insert(payload).select("*").single();
    if (error || !data) return setMsg(error?.message || "Save failed");
    setActs((a) => [data as Activity, ...a]);
    setABody(""); setADue(""); setAContact("");
  }
  async function toggleTask(a: Activity) {
    const { error } = await supabase.from("activities").update({ done: !a.done }).eq("id", a.id);
    if (error) return setMsg(error.message);
    setActs((as) => as.map((x) => (x.id === a.id ? { ...x, done: !a.done } : x)));
  }
  async function deleteActivity(id: string) {
    const { error } = await supabase.from("activities").delete().eq("id", id);
    if (error) return setMsg(error.message);
    setActs((as) => as.filter((x) => x.id !== id));
  }

  // org tree: roots first, children indented; cycle-safe
  const tree = useMemo(() => {
    const kids: Record<string, Contact[]> = {};
    const ids = new Set(contacts.map((c) => c.id));
    const roots: Contact[] = [];
    for (const c of contacts) {
      if (c.reports_to && ids.has(c.reports_to)) (kids[c.reports_to] ??= []).push(c);
      else roots.push(c);
    }
    const out: { c: Contact; depth: number }[] = [];
    const walk = (c: Contact, depth: number, seen: Set<string>) => {
      if (seen.has(c.id)) return;
      seen.add(c.id);
      out.push({ c, depth });
      for (const k of kids[c.id] ?? []) walk(k, depth + 1, seen);
    };
    const seen = new Set<string>();
    roots.forEach((r) => walk(r, 0, seen));
    contacts.forEach((c) => walk(c, 0, seen)); // orphans in cycles
    return out;
  }, [contacts]);

  const openTasks = acts.filter((a) => a.kind === "task" && !a.done);

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", margin: "10px 0" }}>{msg}</div>}

      {/* ---- Stage ---- */}
      <div className="secttl">Stage</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {STAGES.map(([k, label]) => (
          <button key={k} onClick={() => saveStage(k)}
            style={{ border: "1px solid var(--border)", borderRadius: 16, padding: "6px 13px", fontSize: 12.5, fontWeight: 700, cursor: "pointer",
              background: stage === k ? (k === "closed_lost" ? "var(--charcoal)" : k === "closed_won" ? "var(--green)" : "var(--red)") : "#fff",
              color: stage === k ? "#fff" : "var(--ink2)" }}>
            {label}
          </button>
        ))}
      </div>

      {/* ---- Open tasks ---- */}
      {openTasks.length > 0 && (
        <>
          <div className="secttl">Next steps · {openTasks.length}</div>
          {openTasks.map((a) => (
            <div key={a.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
              <input type="checkbox" checked={false} onChange={() => toggleTask(a)} style={{ width: 18, height: 18 }} />
              <div style={{ flex: 1, fontSize: 14 }}>{a.body}</div>
              {a.due_at && <span style={{ fontSize: 12, fontWeight: 700, color: new Date(a.due_at) < new Date() ? "var(--red)" : "var(--ink2)" }}>{fmtDue(a.due_at)}</span>}
            </div>
          ))}
        </>
      )}

      {/* ---- People / org chart ---- */}
      <div className="secttl">People</div>
      {tree.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>No contacts yet — add the people you're selling to and who they report to.</p>}
      {tree.map(({ c, depth }) => {
        const role = c.role_tag ? ROLES[c.role_tag] : null;
        return (
          <div key={c.id} style={{ marginLeft: depth * 26, marginBottom: 6, position: "relative" }}>
            {depth > 0 && <div style={{ position: "absolute", left: -16, top: 0, bottom: 0, width: 2, background: "var(--border)", borderRadius: 2 }} />}
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>
                  {c.name}
                  {role && <span style={{ background: role.color, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 7px", marginLeft: 8, verticalAlign: "middle" }}>{role.label}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>
                  {c.title || "—"}{c.email ? <> · <a href={`mailto:${c.email}`} style={{ color: "var(--blue)" }}>{c.email}</a></> : null}{c.phone ? ` · ${c.phone}` : ""}
                </div>
              </div>
              <button className="mini" onClick={() => setCForm({ id: c.id, name: c.name, title: c.title || "", role_tag: c.role_tag || "", email: c.email || "", phone: c.phone || "", reports_to: c.reports_to || "" })}>Edit</button>
              <button className="mini del" onClick={() => deleteContact(c.id)}>✕</button>
            </div>
          </div>
        );
      })}
      {!cForm && <button className="btn" style={{ marginTop: 4 }} onClick={() => setCForm(emptyC)}>+ Add person</button>}

      {cForm && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="secttl" style={{ marginTop: 0 }}>{cForm.id ? "Edit person" : "New person"}</div>
          <input placeholder="Name *" value={cForm.name} onChange={(e) => setCForm({ ...cForm, name: e.target.value })} style={{ marginBottom: 8 }} />
          <input placeholder="Title (e.g. VP Finance)" value={cForm.title} onChange={(e) => setCForm({ ...cForm, title: e.target.value })} style={{ marginBottom: 8 }} />
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <select value={cForm.role_tag} onChange={(e) => setCForm({ ...cForm, role_tag: e.target.value })} style={{ flex: 1 }}>
              <option value="">Role in the deal…</option>
              {Object.entries(ROLES).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
            </select>
            <select value={cForm.reports_to} onChange={(e) => setCForm({ ...cForm, reports_to: e.target.value })} style={{ flex: 1 }}>
              <option value="">Reports to…</option>
              {contacts.filter((c) => c.id !== cForm.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
            <input placeholder="Email" value={cForm.email} onChange={(e) => setCForm({ ...cForm, email: e.target.value })} style={{ flex: 1 }} />
            <input placeholder="Phone" value={cForm.phone} onChange={(e) => setCForm({ ...cForm, phone: e.target.value })} style={{ flex: 1 }} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" onClick={saveContact}>Save</button>
            <button className="btn" style={{ background: "#fff", color: "var(--ink2)", border: "1px solid var(--border)" }} onClick={() => setCForm(null)}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---- Activity ---- */}
      <div className="secttl">Activity</div>
      <div className="card" style={{ marginBottom: 10 }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <select value={aKind} onChange={(e) => setAKind(e.target.value)} style={{ width: "auto" }}>
            <option value="note">📝 Note</option><option value="call">📞 Call</option>
            <option value="meeting">🤝 Meeting</option><option value="email">✉️ Email</option>
            <option value="task">✅ Task</option>
          </select>
          {contacts.length > 0 && (
            <select value={aContact} onChange={(e) => setAContact(e.target.value)} style={{ width: "auto" }}>
              <option value="">With…</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {aKind === "task" && <input type="date" value={aDue} onChange={(e) => setADue(e.target.value)} style={{ width: "auto" }} />}
        </div>
        <textarea rows={2} placeholder={aKind === "task" ? "Next step…" : "What happened…"} value={aBody} onChange={(e) => setABody(e.target.value)}
          style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 14 }} />
        <button className="btn" style={{ marginTop: 8 }} disabled={!aBody.trim()} onClick={addActivity}>Log it</button>
      </div>

      {acts.map((a) => (
        <div key={a.id} className="card" style={{ display: "flex", gap: 10, marginBottom: 6, padding: "10px 12px", opacity: a.kind === "task" && a.done ? 0.6 : 1 }}>
          <div style={{ fontSize: 18 }}>{KIND_ICON[a.kind] || "📝"}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, textDecoration: a.kind === "task" && a.done ? "line-through" : "none" }}>{a.body}</div>
            <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 2 }}>
              {fmtWhen(a.created_at)}{a.user_id && emailOf[a.user_id] ? ` · ${emailOf[a.user_id].split("@")[0]}` : ""}
              {a.contact_id && contactName[a.contact_id] ? ` · with ${contactName[a.contact_id]}` : ""}
              {a.kind === "task" && a.due_at ? ` · due ${fmtDue(a.due_at)}` : ""}
            </div>
          </div>
          {a.kind === "task" && <input type="checkbox" checked={a.done} onChange={() => toggleTask(a)} style={{ width: 18, height: 18 }} />}
          <button className="mini del" onClick={() => deleteActivity(a.id)}>✕</button>
        </div>
      ))}
      {acts.length === 0 && <p style={{ fontSize: 13, color: "var(--muted)" }}>Nothing logged yet.</p>}

      <style>{`
        .secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 8px}
        .mini{border:1px solid var(--border);background:#fff;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer}
        .mini.del{color:var(--red)}
      `}</style>
    </div>
  );
}
