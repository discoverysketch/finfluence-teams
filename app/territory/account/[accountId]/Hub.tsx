"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { createClient } from "@/lib/supabase/client";
import { inferReporting } from "@/lib/orgchart";
import { classifyFiling, SUGGESTED_MOVE } from "@/lib/signalTypes";
import PrepBrief from "./PrepBrief";
import DraftOutreach from "@/components/DraftOutreach";
import CaptureNotes from "./CaptureNotes";
import WhatChanged from "@/components/WhatChanged";

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

// financials (moved here from the book list — the Hub is the account's home)
function fmtM(v: number) {
  const a = Math.abs(v);
  if (a >= 1000) return `${v < 0 ? "-" : ""}$${(a / 1000).toFixed(1)}B`;
  return `${v < 0 ? "-" : ""}$${Math.round(a)}M`;
}
const fmtDate = (s?: string) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const FY_ROWS: [string, string][] = [["fy_revenue", "Revenue"], ["fy_operatingIncome", "Operating income"], ["fy_netIncome", "Net income"], ["fy_operatingCashFlow", "Op. cash flow"], ["fy_capex", "Capex"]];
const BAL_ROWS: [string, string][] = [["totalAssets", "Total assets"], ["totalEquity", "Total equity"], ["totalDebt", "Total debt"], ["cash", "Cash"]];
type Stock = { loading?: boolean; error?: string; points?: { d: string; c: number }[]; price?: number; currency?: string; asOf?: string };
type EiaOps = { period: string; source_url: string; facts: Record<string, number> };
type FinState = { loading?: boolean; error?: string; period?: string; source_url?: string; asOf?: string; annualLabel?: string | null; items?: { key: string; value: number }[]; stock?: Stock; eia?: EiaOps | null; ferc?: EiaOps | null };

// FERC Form 1: regulated-utility financial detail no 10-K carries — net utility
// plant (the rate-base proxy a utility CFO earns a return on), CWIP, O&M.
function FercBlock({ ferc }: { ferc: EiaOps }) {
  const f = ferc.facts;
  // 5-year rate-base trend from year-suffixed history keys (load-ferc.mjs).
  const hist = Object.keys(f).filter((k) => /^net_utility_plant_\d{4}$/.test(k))
    .map((k) => ({ y: k.slice(-4), rateBase: f[k] }))
    .sort((a, b) => a.y.localeCompare(b.y));
  const cagr = hist.length >= 3 ? (Math.pow(hist[hist.length - 1].rateBase / hist[0].rateBase, 1 / (hist.length - 1)) - 1) * 100 : null;
  const Cell = ({ n, l }: { n: string; l: string }) => (
    <div style={{ border: "1px solid #F0EAE0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>{n}</div>
      <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 6 }}>
        🏛️ Regulated financials · FERC Form 1 {ferc.period}{(f.respondents_count ?? 0) > 1 ? ` · across ${f.respondents_count} respondents` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {f.net_utility_plant != null && <Cell n={fmtM(f.net_utility_plant)} l="net utility plant (rate-base proxy)" />}
        {f.cwip != null && <Cell n={fmtM(f.cwip)} l="construction work in progress" />}
        {f.om_expense != null && <Cell n={fmtM(f.om_expense)} l="electric O&M expense" />}
        {f.electric_revenue != null && <Cell n={fmtM(f.electric_revenue)} l="electric operating revenue" />}
      </div>
      {hist.length >= 3 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink2)" }}>Rate-base trend · {hist[0].y}–{hist[hist.length - 1].y}</span>
            {cagr != null && <span style={{ fontSize: 12.5, fontWeight: 800, color: cagr >= 0 ? "#1B7A47" : "var(--red)" }}>{cagr >= 0 ? "+" : ""}{cagr.toFixed(1)}%/yr</span>}
          </div>
          <ResponsiveContainer width="100%" height={90}>
            <LineChart data={hist} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
              <XAxis dataKey="y" tick={{ fontSize: 9 }} />
              <YAxis tick={{ fontSize: 9 }} width={46} domain={["auto", "auto"]} tickFormatter={(v) => fmtM(v as number)} />
              <Tooltip formatter={(v) => [fmtM(v as number), "Net utility plant"]} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 12 }} />
              <Line type="monotone" dataKey="rateBase" stroke="#006B72" strokeWidth={2} dot={{ r: 2.5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
        What the CFO earns a regulated return on{cagr != null ? ` — growing ${cagr >= 0 ? "+" : ""}${cagr.toFixed(1)}%/yr` : ""} · <a href={ferc.source_url.split(" ")[0]} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>PUDL / FERC ↗</a>
      </div>
    </div>
  );
}
const fmtCount = (v: number) => (v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v)));
const fmtEnergy = (mwh: number) => (mwh >= 1e6 ? `${(mwh / 1e6).toFixed(1)} TWh` : `${Math.round(mwh / 1e3)} GWh`);

// EIA-861 utility-operations block: the data layer that exists even for
// munis/co-ops with no SEC filings.
function EiaBlock({ eia }: { eia: EiaOps }) {
  const f = eia.facts;
  const mixTotal = (f.res_revenue || 0) + (f.com_revenue || 0) + (f.ind_revenue || 0);
  const mix: [string, number, string][] = mixTotal > 0 ? [
    ["Residential", (f.res_revenue || 0) / mixTotal, "#C8902E"],
    ["Commercial", (f.com_revenue || 0) / mixTotal, "#0572CE"],
    ["Industrial", (f.ind_revenue || 0) / mixTotal, "#006B72"],
  ] : [];
  const rpc = f.customers && f.revenue ? (f.revenue * 1e6) / f.customers : null;
  const Cell = ({ n, l }: { n: string; l: string }) => (
    <div style={{ border: "1px solid #F0EAE0", borderRadius: 8, padding: "8px 10px" }}>
      <div style={{ fontSize: 16, fontWeight: 800, letterSpacing: "-.01em" }}>{n}</div>
      <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
    </div>
  );
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 6 }}>
        ⚡ Utility operations · EIA-861 {eia.period}{(f.utilities_count ?? 0) > 1 ? ` · across ${f.utilities_count} utilities` : ""}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {f.customers != null && <Cell n={fmtCount(f.customers)} l="customers served" />}
        {f.sales_mwh != null && <Cell n={fmtEnergy(f.sales_mwh)} l="energy delivered" />}
        {f.revenue != null && <Cell n={fmtM(f.revenue)} l="retail revenue" />}
        {rpc != null && <Cell n={`$${Math.round(rpc).toLocaleString()}`} l="revenue / customer" />}
      </div>
      {mix.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden" }}>
            {mix.map(([l, p, c]) => <div key={l} style={{ width: `${p * 100}%`, background: c }} />)}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap" }}>
            {mix.map(([l, p, c]) => (
              <span key={l} style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: c, display: "inline-block" }} />{l} {Math.round(p * 100)}%
              </span>
            ))}
          </div>
        </div>
      )}
      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>
        Revenue mix by customer class · <a href={eia.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>EIA-861 ↗</a>
      </div>
    </div>
  );
}

type CForm = { id?: string; name: string; title: string; role_tag: string; email: string; phone: string; reports_to: string };
const emptyC: CForm = { name: "", title: "", role_tag: "", email: "", phone: "", reports_to: "" };

export default function Hub({ accountId, userId, entityId, ticker, initialStage, initialNotes, initialContacts, initialActivities, emailOf }: {
  accountId: string; userId: string; entityId: string | null; ticker: string | null;
  initialStage: string | null; initialNotes: string | null;
  initialContacts: Contact[]; initialActivities: Activity[]; emailOf: Record<string, string>;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [fin, setFin] = useState<FinState>({ loading: true });
  const [stage, setStage] = useState(initialStage || "prospect");
  const [notes, setNotes] = useState(initialNotes || "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>(initialContacts);
  const [acts, setActs] = useState<Activity[]>(initialActivities);
  const [msg, setMsg] = useState("");
  const [cForm, setCForm] = useState<CForm | null>(null);
  const [execs, setExecs] = useState<{ loading?: boolean; note?: string; staged?: boolean; list?: { name: string; title: string; suggested_role: string; source_url: string; checked: boolean }[] } | null>(null);
  const [autoResearching, setAutoResearching] = useState(false);
  const [aKind, setAKind] = useState("note");
  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const [sig, setSig] = useState<{ events: any[]; news: any[] } | null>(null);
  const [aBody, setABody] = useState("");
  const [aDue, setADue] = useState("");
  const [aContact, setAContact] = useState("");

  const contactName = useMemo(() => Object.fromEntries(contacts.map((c) => [c.id, c.name])), [contacts]);

  // Financials: cached server-side (7-day), so this is cheap on revisit.
  useEffect(() => {
    let live = true;
    (async () => {
      if (!entityId) { setFin({}); return; }
      try {
        const r = await fetch(`/api/entity-facts?entityId=${entityId}`);
        const j = await r.json();
        if (!live) return;
        if (!r.ok) { setFin({ error: j.error || "Couldn't load financials." }); return; }
        setFin({ items: j.facts, period: j.period, source_url: j.source_url, asOf: j.asOf, annualLabel: j.annualLabel, eia: j.eia ?? null, ferc: j.ferc ?? null });
        if (ticker) {
          setFin((f) => ({ ...f, stock: { loading: true } }));
          const sr = await fetch(`/api/stock?ticker=${encodeURIComponent(ticker)}`);
          const sj = await sr.json();
          if (!live) return;
          setFin((f) => ({ ...f, stock: sr.ok ? { points: sj.points, price: sj.price, currency: sj.currency, asOf: sj.asOf } : { error: sj.error || "No price." } }));
        }
      } catch { if (live) setFin({ error: "Network error." }); }
    })();
    return () => { live = false; };
  }, [entityId, ticker]);

  // Account-level signals: this entity's recent filings + industry news that
  // mentions it (same classification + matching as the /signals feed).
  useEffect(() => {
    let live = true;
    (async () => {
      if (!entityId) { setSig({ events: [], news: [] }); return; }
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const [{ data: events }, { data: news }, { data: ent }] = await Promise.all([
        supabase.from("filing_events").select("id, form, filed, items, label")
          .eq("entity_id", entityId).gte("filed", since).order("filed", { ascending: false }).limit(5),
        supabase.from("news_items").select("*").order("created_at", { ascending: false }).limit(30),
        supabase.from("entities").select("canonical_name, ticker").eq("id", entityId).maybeSingle(),
      ]);
      if (!live) return;
      const words = String(ent?.canonical_name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
        .filter((w) => w.length > 3 && !["corp", "corporation", "company", "energy", "inc", "group", "holdings"].includes(w));
      const keys = [...(ent?.ticker ? [String(ent.ticker).toLowerCase()] : []), words.slice(0, 2).join(" ")].filter((s) => s.length > 3);
      const newsCut = Date.now() - 30 * 24 * 3600 * 1000;
      /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
      const mentions = (news ?? []).filter((n: any) => {
        const d = n.published ? new Date(n.published + "T12:00:00") : new Date(n.created_at);
        if (+d < newsCut) return false;
        const hay = `${n.headline} ${n.companies || ""} ${n.summary || ""}`.toLowerCase();
        return keys.some((k) => hay.includes(k));
      }).slice(0, 3);
      setSig({ events: events ?? [], news: mentions });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId]);

  async function removeAccount() {
    if (!window.confirm("Remove this account from your book? Contacts and activity for it will be deleted too.")) return;
    const { error } = await supabase.from("accounts").delete().eq("id", accountId);
    if (error) { setMsg(error.message); return; }
    router.replace("/territory");
    router.refresh();
  }

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

  // ---- staged people research (kicked off when the account was added) ----
  // Surface staged results as the same pre-filled review list the manual finder
  // uses; poll briefly while the background research is still running.
  const contactsRef = useRef(contacts);
  contactsRef.current = contacts;
  useEffect(() => {
    let live = true; let tries = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    const check = async () => {
      const { data } = await supabase.from("accounts").select("suggested_execs, execs_status").eq("id", accountId).maybeSingle();
      if (!live || !data) return;
      if (data.execs_status === "pending") {
        setAutoResearching(true);
        if (++tries < 40) timer = setTimeout(check, 8000); else setAutoResearching(false);
        return;
      }
      setAutoResearching(false);
      if (data.execs_status === "ready" && Array.isArray(data.suggested_execs) && data.suggested_execs.length) {
        const existing = new Set(contactsRef.current.map((c) => c.name.toLowerCase().trim()));
        const fresh = (data.suggested_execs as { name: string; title: string; suggested_role: string; source_url: string }[])
          .filter((e) => e?.name && !existing.has(e.name.toLowerCase().trim()));
        if (fresh.length) setExecs((x) => x ?? { list: fresh.map((e) => ({ ...e, checked: true })), note: "found when this account was added", staged: true });
        else clearStaged(); // everyone already in the chart — nothing to review
      }
    };
    check();
    return () => { live = false; if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);
  async function clearStaged() {
    await supabase.from("accounts").update({ suggested_execs: null, execs_status: null }).eq("id", accountId);
  }

  // ---- executive finder (web research -> review -> save) ----
  async function findExecs() {
    if (execs?.loading) return;
    setExecs({ loading: true });
    try {
      const r = await fetch("/api/find-executives", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j) { setMsg(j?.error || "Executive search failed — try again or add manually."); setExecs(null); return; }
      const existing = new Set(contacts.map((c) => c.name.toLowerCase().trim()));
      const fresh = (j.executives as any[]).filter((e) => !existing.has(String(e.name).toLowerCase().trim()));
      const skipped = j.executives.length - fresh.length;
      if (!fresh.length) { setMsg("Everyone found is already in your org chart."); setExecs(null); return; }
      setExecs({ list: fresh.map((e) => ({ ...e, checked: true })), note: skipped ? `${skipped} already in your chart — skipped` : undefined });
    } catch { setMsg("Network error."); setExecs(null); }
  }
  async function addExecs() {
    const picked = execs?.list?.filter((e) => e.checked) ?? [];
    if (!picked.length) return;
    const rows = picked.map((e) => ({
      account_id: accountId, name: e.name, title: e.title || null,
      role_tag: e.suggested_role || null, notes: `Source: ${e.source_url}`,
    }));
    const { data, error } = await supabase.from("contacts").insert(rows).select("*");
    if (error) { setMsg(error.message); return; }
    let added = (data ?? []) as Contact[];
    // Auto-wire the hierarchy from titles (chiefs -> CEO, VPs -> domain chief);
    // only the newly added people get wired — manual links are never touched.
    const links = inferReporting([...contacts, ...added], added);
    for (const l of links) {
      await supabase.from("contacts").update({ reports_to: l.reports_to }).eq("id", l.id);
      added = added.map((c) => (c.id === l.id ? { ...c, reports_to: l.reports_to } : c));
    }
    setContacts((cs) => [...cs, ...added]);
    if (execs?.staged) clearStaged();
    setExecs(null);
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

  // org chart: children map + roots (cycle-safe — unreachable nodes surface as roots)
  const orgTree = useMemo(() => {
    const kids: Record<string, Contact[]> = {};
    const ids = new Set(contacts.map((c) => c.id));
    const roots: Contact[] = [];
    for (const c of contacts) {
      if (c.reports_to && ids.has(c.reports_to)) (kids[c.reports_to] ??= []).push(c);
      else roots.push(c);
    }
    const seen = new Set<string>();
    const mark = (c: Contact) => { if (seen.has(c.id)) return; seen.add(c.id); (kids[c.id] ?? []).forEach(mark); };
    roots.forEach(mark);
    for (const c of contacts) if (!seen.has(c.id)) { roots.push(c); mark(c); }
    return { kids, roots };
  }, [contacts]);

  function OrgNode({ c }: { c: Contact }) {
    const role = c.role_tag ? ROLES[c.role_tag] : null;
    const children = orgTree.kids[c.id] ?? [];
    return (
      <li>
        <div className="ocnode" style={{ borderTop: `3px solid ${role ? role.color : "var(--border)"}` }}
          onClick={() => setCForm({ id: c.id, name: c.name, title: c.title || "", role_tag: c.role_tag || "", email: c.email || "", phone: c.phone || "", reports_to: c.reports_to || "" })}>
          <button className="ocdel" aria-label={`Remove ${c.name}`} onClick={(e) => { e.stopPropagation(); deleteContact(c.id); }}>×</button>
          <div style={{ fontWeight: 700, fontSize: 12.5, lineHeight: 1.2 }}>{c.name}</div>
          <div style={{ fontSize: 10.5, color: "var(--ink2)", marginTop: 2, lineHeight: 1.25 }}>{c.title || "—"}</div>
          {role && <div style={{ fontSize: 9, fontWeight: 700, color: role.color, marginTop: 3, textTransform: "uppercase", letterSpacing: ".4px" }}>{role.label}</div>}
        </div>
        {children.length > 0 && <ul>{children.map((k) => <OrgNode key={k.id} c={k} />)}</ul>}
      </li>
    );
  }

  // org-chart horizontal scroll: show arrows only when there's actually more chart off-screen
  const ocRef = useRef<HTMLDivElement | null>(null);
  const [ocArrows, setOcArrows] = useState({ left: false, right: false });
  const updateOcArrows = () => {
    const el = ocRef.current; if (!el) return;
    setOcArrows({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    updateOcArrows();
    window.addEventListener("resize", updateOcArrows);
    return () => window.removeEventListener("resize", updateOcArrows);
  }, [contacts]);
  const ocScroll = (dir: 1 | -1) => ocRef.current?.scrollBy({ left: dir * Math.max(240, (ocRef.current?.clientWidth ?? 300) * 0.7), behavior: "smooth" });

  const openTasks = acts.filter((a) => a.kind === "task" && !a.done);

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", margin: "10px 0" }}>{msg}</div>}

      <PrepBrief accountId={accountId} />

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

      {/* ---- Financials ---- */}
      {entityId && (
        <>
          <div className="secttl">Financials</div>
          <div className="card" style={{ padding: "13px 14px" }}>
            {fin.loading && <div style={{ fontSize: 13, color: "var(--ink2)" }}>Pulling data…</div>}
            {fin.error && <div style={{ fontSize: 13, color: "var(--muted)" }}>{fin.error}</div>}
            {fin.items && (() => {
              const fmap: Record<string, number> = Object.fromEntries(fin.items.map((i) => [i.key, i.value]));
              const fyRows = FY_ROWS.filter(([k]) => fmap[k] != null);
              const balRows = BAL_ROWS.filter(([k]) => fmap[k] != null);
              const st = fin.stock;
              const Row = ([k, label]: [string, string]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
                  <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtM(fmap[k])}</span>
                </div>
              );
              return (
                <>
                  {st?.points && st.points.length > 1 && (
                    <div style={{ marginBottom: 12 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)" }}>Share price · 2y</span>
                        <span style={{ fontSize: 15, fontWeight: 800 }}>${st.price?.toFixed(2)} <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>{st.currency} · through {st.asOf}</span></span>
                      </div>
                      <ResponsiveContainer width="100%" height={120}>
                        <LineChart data={st.points} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
                          <XAxis dataKey="d" tick={{ fontSize: 9 }} interval={Math.floor(st.points.length / 5)} tickFormatter={(d) => String(d).slice(0, 7)} />
                          <YAxis tick={{ fontSize: 9 }} width={40} domain={["auto", "auto"]} tickFormatter={(v) => `$${Math.round(v as number)}`} />
                          <Tooltip formatter={(v) => `$${(v as number).toFixed(2)}`} labelStyle={{ fontSize: 11 }} contentStyle={{ fontSize: 12 }} />
                          <Line type="monotone" dataKey="c" stroke="var(--red)" strokeWidth={2} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                  {fyRows.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 4 }}>Full fiscal year {fin.annualLabel} · $M</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px", marginBottom: 10 }}>{fyRows.map(Row)}</div>
                    </>
                  )}
                  {balRows.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 4 }}>Balance sheet · latest ({fin.period?.replace(" · SEC EDGAR", "")}) · $M</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px", marginBottom: 8 }}>{balRows.map(Row)}</div>
                    </>
                  )}
                  {fyRows.length === 0 && balRows.length === 0 && !fin.eia && <div style={{ fontSize: 13, color: "var(--ink2)" }}>No figures reported.</div>}
                  {(fyRows.length > 0 || balRows.length > 0) && (
                    <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                      Financials as of {fin.period?.replace(" · SEC EDGAR", "")} · pulled {fmtDate(fin.asOf)}
                      {fin.source_url && <> · <a href={fin.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>SEC filings ↗</a></>}
                    </div>
                  )}
                  {fin.eia && <EiaBlock eia={fin.eia} />}
                  {fin.ferc && <FercBlock ferc={fin.ferc} />}
                </>
              );
            })()}
          </div>
        </>
      )}

      {/* ---- Signals: recent filings + news mentions for THIS account ---- */}
      {sig && (sig.events.length > 0 || sig.news.length > 0) && (
        <>
          <div className="secttl" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <span>Signals</span>
            <a href="/signals" style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", textTransform: "none", letterSpacing: 0 }}>All signals →</a>
          </div>
          <div className="card" style={{ padding: "6px 14px" }}>
            {sig.events.map((ev, i) => {
              const s = classifyFiling(ev.form, ev.items) ?? { kind: "earnings" as const, label: ev.label || `${ev.form} filed`, icon: "📄" };
              const lastRow = i === sig.events.length - 1 && sig.news.length === 0;
              return (
                <div key={ev.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: lastRow ? "none" : "1px solid #F0EAE0", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, lineHeight: 1.2 }}>{s.icon}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <span style={{ fontSize: 13.5, fontWeight: 700 }}>{ev.label || s.label}</span>
                      <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, flexShrink: 0 }}>{fmtDue(ev.filed)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{SUGGESTED_MOVE[s.kind]}</div>
                    <div style={{ display: "flex", gap: 12, marginTop: 4, flexWrap: "wrap", alignItems: "center" }}>
                      <DraftOutreach accountId={accountId} trigger={{ kind: "filing", title: ev.label || s.label, detail: SUGGESTED_MOVE[s.kind], date: ev.filed }} />
                      {s.kind === "earnings" && entityId && <WhatChanged entityId={entityId} />}
                    </div>
                  </div>
                </div>
              );
            })}
            {sig.news.map((n, i) => {
              const isRate = n.category === "rates";
              return (
                <div key={n.id} style={{ display: "flex", gap: 10, padding: "9px 0", borderBottom: i === sig.news.length - 1 ? "none" : "1px solid #F0EAE0", alignItems: "flex-start" }}>
                  <span style={{ fontSize: 18, lineHeight: 1.2 }}>{isRate ? "⚖️" : "📰"}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                      <a href={n.source_url} target="_blank" rel="noreferrer" style={{ fontSize: 13.5, fontWeight: 700, color: "inherit" }}>{n.headline}</a>
                      {n.published && <span style={{ fontSize: 11.5, color: "var(--muted)", fontWeight: 600, flexShrink: 0 }}>{fmtDue(n.published)}</span>}
                    </div>
                    {n.summary && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>{n.summary}</div>}
                    {isRate && <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}><b style={{ color: "#006B72" }}>Rate case in play</b> — capital program under regulatory scrutiny; efficiency-story timing is now.</div>}
                    <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 4, flexWrap: "wrap" }}>
                      <span style={{ background: isRate ? "#006B72" : "var(--gold)", color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: "1px 6px" }}>{isRate ? "⚖️ rate case · this account" : "★ mentions this account"}</span>
                      <DraftOutreach accountId={accountId} trigger={{ kind: isRate ? "rate_case" : "news", title: n.headline, detail: n.summary, date: n.published || undefined, url: n.source_url }} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ---- People / org chart ---- */}
      <div className="secttl">People</div>
      {autoResearching && !execs?.list && (
        <p style={{ fontSize: 12.5, color: "#9A6700", fontWeight: 600, margin: "0 0 8px" }}>
          🔍 Researching this account&apos;s leadership in the background — people will appear here for review shortly.
        </p>
      )}
      {contacts.length === 0 && !autoResearching && <p style={{ fontSize: 13, color: "var(--muted)", margin: "0 0 8px" }}>No contacts yet — add the people you&apos;re selling to and who they report to.</p>}
      {contacts.length > 0 && (
        <>
          <div style={{ position: "relative" }}>
            <div className="oc-wrap" ref={ocRef} onScroll={updateOcArrows}>
              <ul className="oc">
                {orgTree.roots.map((r) => <OrgNode key={r.id} c={r} />)}
              </ul>
            </div>
            {ocArrows.left && (
              <>
                <div className="ocfade" style={{ left: 0, background: "linear-gradient(90deg, var(--bg, #FBF7EF), transparent)" }} />
                <button className="ocarr" style={{ left: 4 }} aria-label="Scroll chart left" onClick={() => ocScroll(-1)}>‹</button>
              </>
            )}
            {ocArrows.right && (
              <>
                <div className="ocfade" style={{ right: 0, background: "linear-gradient(270deg, var(--bg, #FBF7EF), transparent)" }} />
                <button className="ocarr" style={{ right: 4 }} aria-label="Scroll chart right" onClick={() => ocScroll(1)}>›</button>
              </>
            )}
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "6px 0 0" }}>Tap a person to edit · set &quot;Reports to&quot; to build the chart{ocArrows.right ? " · scroll for more →" : ""}</p>
        </>
      )}
      {!cForm && (
        <div style={{ display: "flex", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
          <button className="btn" onClick={() => setCForm(emptyC)}>+ Add person</button>
          <button onClick={findExecs} disabled={!!execs?.loading || autoResearching}
            style={{ background: "#fff", border: "1.5px dashed #E6CF94", color: "#9A6700", borderRadius: 10, padding: "10px 16px", fontSize: 14, fontWeight: 700,
              cursor: execs?.loading || autoResearching ? "default" : "pointer", opacity: execs?.loading || autoResearching ? 0.45 : 1 }}>
            🔍 {autoResearching ? "Researching in the background…" : execs?.loading ? "Searching the web… (~1 min)" : "Find executives"}
          </button>
        </div>
      )}

      {execs?.list && (
        <div className="card" style={{ marginTop: 10, background: "#FAF6EE", borderColor: "#E6CF94" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "#9A6700" }}>
              Found {execs.list.length} — review before adding{execs.note ? ` · ${execs.note}` : ""}
            </span>
            <button onClick={() => { if (execs?.staged) clearStaged(); setExecs(null); }} style={{ background: "none", border: "none", color: "var(--red)", fontWeight: 800, cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
          {execs.list.map((e, i) => {
            const role = e.suggested_role ? ROLES[e.suggested_role] : null;
            return (
              <label key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid #F0E8D8", cursor: "pointer" }}>
                <input type="checkbox" checked={e.checked} onChange={() => setExecs((x) => x && ({ ...x, list: x.list!.map((y, j) => (j === i ? { ...y, checked: !y.checked } : y)) }))} style={{ width: 17, height: 17 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>
                    {e.name}
                    {role && <span style={{ background: role.color, color: "#fff", fontSize: 9.5, fontWeight: 700, borderRadius: 4, padding: "1px 6px", marginLeft: 7, verticalAlign: "middle" }}>{role.label}</span>}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink2)" }}>{e.title} · <a href={e.source_url} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} style={{ color: "var(--blue)" }}>source ↗</a></div>
                </div>
              </label>
            );
          })}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 10 }}>
            <button className="btn" onClick={addExecs} disabled={!execs.list.some((e) => e.checked)}>
              Add {execs.list.filter((e) => e.checked).length} to people
            </button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>Titles from public sources — verify before outreach.</span>
          </div>
        </div>
      )}

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
      <CaptureNotes accountId={accountId} userId={userId}
        onSaved={(rows) => setActs((a) => [...(rows as Activity[]), ...a])}
        onStage={(s) => saveStage(s)} />
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

      <p style={{ marginTop: 26 }}>
        <button onClick={removeAccount} style={{ background: "none", border: "1px solid var(--border)", color: "var(--red)", borderRadius: 8, padding: "8px 14px", fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>
          Remove account from book
        </button>
      </p>

      <style>{`
        .secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:22px 0 8px}
        /* org chart — classic CSS tree with connector lines */
        .oc-wrap{overflow-x:auto;padding:4px 2px 8px;scrollbar-width:thin}
        .ocfade{position:absolute;top:0;bottom:8px;width:36px;pointer-events:none;z-index:1}
        .ocarr{position:absolute;top:50%;transform:translateY(-50%);z-index:2;width:30px;height:30px;border-radius:50%;border:1px solid var(--border);background:#fff;color:var(--ink2);font-size:19px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 2px 8px rgba(40,30,10,.18);display:flex;align-items:center;justify-content:center;padding:0 0 2px}
        .ocarr:active{background:#F6F1E7}
        .oc,.oc ul{list-style:none;margin:0;padding:0}
        .oc{display:flex;justify-content:flex-start;min-width:min-content}
        .oc ul{display:flex;padding-top:22px;position:relative}
        .oc ul::before{content:'';position:absolute;top:0;left:50%;width:2px;height:22px;background:#D8CFC0}
        .oc li{display:flex;flex-direction:column;align-items:center;position:relative;padding:22px 6px 0}
        .oc li::before,.oc li::after{content:'';position:absolute;top:0;right:50%;border-top:2px solid #D8CFC0;width:50%;height:22px}
        .oc li::after{right:auto;left:50%;border-left:2px solid #D8CFC0}
        .oc li:only-child::before,.oc li:only-child::after{border-top:0}
        .oc li:only-child::after{left:50%;border-left:2px solid #D8CFC0}
        .oc li:first-child::before,.oc li:last-child::after{border:0 none}
        .oc li:last-child::before{border-right:2px solid #D8CFC0;border-radius:0 8px 0 0}
        .oc li:first-child::after{border-radius:8px 0 0 0}
        .oc>li{padding-top:0}
        .oc>li::before,.oc>li::after{display:none}
        .ocnode{position:relative;background:#fff;border:1px solid rgba(224,216,203,.85);border-radius:10px;padding:9px 12px 8px;min-width:118px;max-width:160px;text-align:center;cursor:pointer;box-shadow:var(--shadow-sm);transition:transform .18s ease,box-shadow .18s ease}
        .ocnode:hover{transform:translateY(-1px);box-shadow:var(--shadow-md)}
        .ocdel{position:absolute;top:2px;right:5px;background:none;border:none;color:#C9BDA9;font-weight:800;font-size:13px;line-height:1;cursor:pointer;padding:2px}
        .ocdel:hover{color:var(--red)}
        .mini{border:1px solid var(--border);background:#fff;border-radius:6px;padding:5px 9px;font-size:12px;font-weight:700;cursor:pointer}
        .mini.del{color:var(--red)}
      `}</style>
    </div>
  );
}
