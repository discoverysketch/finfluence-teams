"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { createClient } from "@/lib/supabase/client";

type Ent = { id: string; canonical_name: string; ticker: string | null; data_tier: string | null; entity_type: string | null; hq_state: string | null };
export type Account = { id: string; rep_notes: string | null; crm_stage: string | null; entity: Ent | null };
type Cand = { id: string; canonical_name: string; ticker: string | null; cik: string | null; entity_type: string | null; data_tier: string | null; hq_state: string | null; score: number; matched_alias?: string | null };
type MatchRow = { name: string; candidates: Cand[]; selectedId: string };

const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };
function TierBadge({ t }: { t: string | null }) {
  const tier = t || "?";
  return <span style={{ background: TIER_COLOR[tier] || "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Tier {tier}</span>;
}

function fmtM(v: number) {
  const a = Math.abs(v);
  if (a >= 1000) return `${v < 0 ? "-" : ""}$${(a / 1000).toFixed(1)}B`;
  return `${v < 0 ? "-" : ""}$${Math.round(a)}M`;
}
type Stock = { loading?: boolean; error?: string; points?: { d: string; c: number }[]; price?: number; currency?: string; asOf?: string };
type FactState = { loading?: boolean; error?: string; company?: string; period?: string; source_url?: string; asOf?: string; annualLabel?: string | null; items?: { key: string; value: number }[]; stock?: Stock };
const fmtDate = (s?: string) => { if (!s) return ""; const d = new Date(s); return isNaN(+d) ? "" : d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); };
const FY_ROWS: [string, string][] = [["fy_revenue", "Revenue"], ["fy_operatingIncome", "Operating income"], ["fy_netIncome", "Net income"], ["fy_operatingCashFlow", "Op. cash flow"], ["fy_capex", "Capex"]];
const BAL_ROWS: [string, string][] = [["totalAssets", "Total assets"], ["totalEquity", "Total equity"], ["totalDebt", "Total debt"], ["cash", "Cash"]];
type Profile = { canonical_name: string; entity_type: string; hq_state: string; ownership: string; est_size: string; segment: string; summary: string; sources: { title: string; url: string }[]; confidence: string };
const TYPE_LABEL: Record<string, string> = { iou: "Investor-owned utility", ipp: "Independent power producer", coop: "Cooperative", muni: "Municipal", retailer: "Retailer", other: "Other" };

export default function Territory({ listId, initial }: { listId: string; initial: Account[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [names, setNames] = useState("");
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Record<string, FactState>>({});
  const [pName, setPName] = useState("");
  const [pHint, setPHint] = useState("");
  const [researching, setResearching] = useState(false);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [savingP, setSavingP] = useState(false);
  const [stage, setStage] = useState("");
  const [prog, setProg] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const existingIds = new Set(initial.map((a) => a.entity?.id).filter(Boolean));

  async function loadFacts(a: Account) {
    const eid = a.entity?.id;
    if (!eid) return;
    if (openId === a.id) { setOpenId(null); return; }
    setOpenId(a.id);
    if (facts[a.id]?.items || facts[a.id]?.error) return; // already fetched
    setFacts((f) => ({ ...f, [a.id]: { loading: true } }));
    try {
      const r = await fetch(`/api/entity-facts?entityId=${eid}`);
      const j = await r.json();
      if (!r.ok) { setFacts((f) => ({ ...f, [a.id]: { error: j.error || "Couldn't load." } })); return; }
      setFacts((f) => ({ ...f, [a.id]: { company: j.company, period: j.period, source_url: j.source_url, items: j.facts, asOf: j.asOf, annualLabel: j.annualLabel } }));
    } catch { setFacts((f) => ({ ...f, [a.id]: { error: "Network error." } })); return; }
    // Stock price (only when there's a ticker).
    const tk = a.entity?.ticker;
    if (tk) {
      setFacts((f) => ({ ...f, [a.id]: { ...f[a.id], stock: { loading: true } } }));
      try {
        const sr = await fetch(`/api/stock?ticker=${encodeURIComponent(tk)}`);
        const sj = await sr.json();
        setFacts((f) => ({ ...f, [a.id]: { ...f[a.id], stock: sr.ok ? { points: sj.points, price: sj.price, currency: sj.currency, asOf: sj.asOf } : { error: sj.error || "No price." } } }));
      } catch { setFacts((f) => ({ ...f, [a.id]: { ...f[a.id], stock: { error: "Price unavailable." } } })); }
    }
  }

  // Names contain commas ("NRG Energy, Inc."), so split on newlines when present;
  // only treat commas as separators for single-line pastes. Strip CSV quotes.
  function parseNames(text: string): { list: string[]; dupes: number; truncated: number } {
    const raw = text.includes("\n") ? text.split(/\r?\n/) : text.split(",");
    const seen = new Set<string>();
    const list: string[] = [];
    let dupes = 0;
    for (const s0 of raw) {
      const s = s0.trim().replace(/^"(.*)"$/s, "$1").trim();
      if (s.length < 2) continue;
      const k = s.toLowerCase();
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k); list.push(s);
    }
    const truncated = Math.max(0, list.length - 200);
    return { list: list.slice(0, 200), dupes, truncated };
  }

  // First CSV column, honoring quoted fields (names often contain commas).
  function firstCol(line: string): string {
    const t = line.trim();
    if (t.startsWith('"')) { const end = t.indexOf('"', 1); if (end > 0) return t.slice(1, end); }
    return t.split(",")[0];
  }
  function onFile(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => setNames(String(reader.result || "").split(/\r?\n/).map(firstCol).join("\n"));
    reader.readAsText(f);
  }

  const [parseNote, setParseNote] = useState("");

  async function match() {
    const { list, dupes, truncated } = parseNames(names);
    if (!list.length) { setMsg("Paste at least one account name."); return; }
    setBusy(true); setMsg("");
    setParseNote([
      dupes ? `${dupes} exact duplicate${dupes === 1 ? "" : "s"} removed` : "",
      truncated ? `first 200 kept (${truncated} over the limit skipped)` : "",
    ].filter(Boolean).join(" · "));
    try {
      const out: MatchRow[] = [];
      for (let i = 0; i < list.length; i += 10) {
        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ")
          .replace(/\b(the|inc|corp|corporation|co|company|companies|ltd|llc|lp|plc|holdings?|group)\b/g, " ")
          .replace(/\s+/g, " ").trim();
        const chunk = await Promise.all(list.slice(i, i + 10).map(async (name) => {
          const { data } = await supabase.rpc("match_entities", { q: name, lim: 6 });
          const qn = norm(name);
          // If the official name IS the typed name (minus suffixes), it's a direct
          // match even when a subsidiary alias happened to score highest — don't let
          // the alias tag drag it under the stricter alias bar ("Duke Energy" vs
          // "Duke Energy CORP" tagged via "Duke Energy Ohio").
          const candidates = ((data ?? []) as Cand[]).map((c) => {
            const cn = norm(c.canonical_name);
            return c.matched_alias && (cn === qn || cn.startsWith(qn + " ") || qn.startsWith(cn + " "))
              ? { ...c, matched_alias: null } : c;
          });
          // Weak alias hits (<85%) are often generic-word noise ("NV Energy" partial-
          // matching anything with "Energy") — sink them below direct name matches.
          const adj = (c: Cand) => (c.matched_alias && c.score < 0.85 ? c.score * 0.6 : c.score);
          candidates.sort((a, b) => adj(b) - adj(a));
          // Only preselect confident matches — low-similarity top hits are often the
          // wrong company (e.g. "TXU Energy" → TXNM at 50%); default those to None.
          // Fuzzy ALIAS hits need a higher bar: similarly-named subsidiaries of
          // different parents can cross-match ("...of NM" → "...of Colorado" alias).
          const top = candidates[0];
          const confident = top && top.score >= (top.matched_alias ? 0.8 : 0.55);
          return { name, candidates, selectedId: confident ? top.id : "none" };
        }));
        out.push(...chunk);
      }
      setRows(out);
    } catch { setMsg("Matching failed — is the directory loaded?"); }
    finally { setBusy(false); }
  }

  // Several names can resolve to the SAME company ("NRG Energy" + "NRG Energy, Inc.")
  // — add each matched entity once, and skip ones already in the book.
  function uniqueToAdd(rs: MatchRow[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rs) {
      const id = r.selectedId;
      if (!id || id === "none" || existingIds.has(id) || seen.has(id)) continue;
      seen.add(id); out.push(id);
    }
    return out;
  }

  async function confirm() {
    if (!rows) return;
    const ids = uniqueToAdd(rows);
    if (!ids.length) { setMsg("Nothing new to add — pick at least one match."); return; }
    setBusy(true);
    const { error } = await supabase.from("accounts").insert(ids.map((entity_id) => ({ list_id: listId, entity_id })));
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setRows(null); setNames(""); setParseNote(""); router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this account?")) return;
    await supabase.from("accounts").delete().eq("id", id);
    router.refresh();
  }

  async function research() {
    if (pName.trim().length < 2) return;
    setResearching(true); setMsg(""); setDraft(null); setStage("Starting…"); setProg(5); setElapsed(0);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    const creep = setInterval(() => setProg((p) => (p < 92 ? p + (p < 60 ? 0.7 : 0.3) : p)), 400);
    try {
      const r = await fetch("/api/entity-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: pName, hint: pHint }) });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); setMsg(j.error || "Research failed."); return; }
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = ""; let terminal = false;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (!line) continue;
          let ev: any; try { ev = JSON.parse(line); } catch { continue; }
          if (ev.stage === "searching") { setStage("Searching the web…"); setProg((p) => Math.max(p, 14)); }
          else if (ev.stage === "structuring") { setStage(ev.sources ? `Found ${ev.sources} source${ev.sources === 1 ? "" : "s"} — writing the profile…` : "Writing the profile…"); setProg((p) => Math.max(p, 74)); }
          else if (ev.stage === "done") { setProg(100); setStage("Done"); setDraft(ev.profile); terminal = true; }
          else if (ev.stage === "error") { setMsg(ev.error || "Research failed."); terminal = true; }
        }
      }
      if (!terminal) setMsg("Research is taking unusually long — please try again, ideally with a state or parent-company hint.");
    } catch { setMsg("Network error."); }
    finally { clearInterval(tick); clearInterval(creep); setResearching(false); setStage(""); }
  }
  async function saveProfile() {
    if (!draft || !listId) return;
    setSavingP(true); setMsg("");
    try {
      const r = await fetch("/api/save-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: draft, listId }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Save failed."); return; }
      setDraft(null); setPName(""); setPHint(""); router.refresh();
    } catch { setMsg("Network error."); }
    finally { setSavingP(false); }
  }

  const matched = rows?.filter((r) => r.selectedId !== "none").length ?? 0;

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}

      {/* intake */}
      {!rows && (
        <div className="card">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "#fff", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 10 }}>
            📎 Upload a CSV
            <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={6} placeholder={"NextEra Energy\nDuke Energy\nExelon\n…one account per line"}
            style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 14 }} />
          <button className="btn" style={{ marginTop: 10 }} disabled={busy || names.trim().length < 2} onClick={match}>
            {busy ? "Matching…" : "Match accounts"}
          </button>
        </div>
      )}

      {/* match review */}
      {rows && (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
              {matched} of {rows.length} matched · review below
              {parseNote && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · {parseNote}</span>}
            </div>
            <button className="mini" onClick={() => { setRows(null); setMsg(""); setParseNote(""); }}>← Start over</button>
          </div>
          {rows.map((r, i) => {
            const selId = r.selectedId;
            const inBook = selId !== "none" && existingIds.has(selId);
            const dupOf = selId !== "none" && !inBook ? rows.find((x, j) => j < i && x.selectedId === selId) : undefined;
            return (
              <div key={i} className="card" style={{ marginBottom: 8, padding: "12px 14px", opacity: inBook || dupOf ? 0.75 : 1 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{r.name}</div>
                {r.candidates.length === 0 ? (
                  <div style={{ fontSize: 13, color: "var(--muted)" }}>No directory match — skipped here. Use the &quot;Private / non-SEC account&quot; research below.</div>
                ) : (
                  <>
                    <select value={r.selectedId} onChange={(e) => setRows((rs) => rs!.map((x, j) => j === i ? { ...x, selectedId: e.target.value } : x))}
                      style={{ width: "100%", padding: "8px 10px", fontSize: 13.5 }}>
                      {r.candidates.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.canonical_name}{c.ticker ? ` (${c.ticker})` : ""}{c.matched_alias ? ` · matches “${c.matched_alias}”` : ""} · Tier {c.data_tier || "?"} · {Math.round(c.score * 100)}% match
                        </option>
                      ))}
                      <option value="none">— None of these —</option>
                    </select>
                    {inBook && <div style={{ fontSize: 12, color: "#1B7A47", fontWeight: 600, marginTop: 5 }}>✓ Already in your book — will be skipped</div>}
                    {dupOf && <div style={{ fontSize: 12, color: "#9A6700", fontWeight: 600, marginTop: 5 }}>⚠ Same company as “{dupOf.name}” — added once</div>}
                  </>
                )}
              </div>
            );
          })}
          <button className="btn" disabled={busy} onClick={confirm} style={{ marginTop: 4 }}>
            {busy ? "Saving…" : `Confirm & save ${uniqueToAdd(rows).length} account(s)`}
          </button>
        </div>
      )}

      {/* Tier D: private / non-SEC research */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", margin: "24px 0 8px" }}>
        Private / non-SEC account
      </div>
      <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94" }}>
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
          No SEC match (co-op, municipal, private IPP, retailer)? Claude web-researches a <b>sourced</b> profile you review before saving. Can take up to ~2 minutes.
        </p>
        <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Company name, e.g. Pedernales Electric Cooperative" style={{ marginBottom: 8 }} />
        <input value={pHint} onChange={(e) => setPHint(e.target.value)} placeholder="Optional hint — state, parent company…" style={{ marginBottom: 8 }} disabled={researching} />
        <button className="btn" disabled={researching || pName.trim().length < 2} onClick={research}>{researching ? "Researching…" : "🔍 Research"}</button>
        {researching && (
          <div style={{ marginTop: 10 }}>
            <div style={{ height: 8, background: "var(--cream2)", borderRadius: 5, overflow: "hidden" }}>
              <div style={{ width: `${prog}%`, height: "100%", background: "var(--gold)", transition: "width .4s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--ink2)", marginTop: 5 }}>
              <span>{stage || "Starting…"}</span><span>{elapsed}s</span>
            </div>
          </div>
        )}
      </div>

      {draft && (
        <div className="card" style={{ marginTop: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <div style={{ flex: 1, fontWeight: 800, fontSize: 15 }}>{draft.canonical_name}</div>
            <TierBadge t="D" />
            <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: draft.confidence === "high" ? "var(--green)" : draft.confidence === "medium" ? "var(--gold)" : "#8A7E6E", borderRadius: 4, padding: "2px 6px" }}>{draft.confidence} confidence</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3px 10px", fontSize: 13, marginBottom: 6 }}>
            {draft.entity_type && (<><b style={{ color: "var(--ink2)" }}>Type</b><span>{TYPE_LABEL[draft.entity_type] || draft.entity_type}</span></>)}
            {draft.hq_state && (<><b style={{ color: "var(--ink2)" }}>HQ</b><span>{draft.hq_state}</span></>)}
            {draft.ownership && (<><b style={{ color: "var(--ink2)" }}>Ownership</b><span>{draft.ownership}</span></>)}
            {draft.est_size && (<><b style={{ color: "var(--ink2)" }}>Size</b><span>{draft.est_size}</span></>)}
            {draft.segment && (<><b style={{ color: "var(--ink2)" }}>Segment</b><span>{draft.segment}</span></>)}
          </div>
          {draft.summary && <p style={{ fontSize: 13.5, lineHeight: 1.5, margin: "0 0 8px" }}>{draft.summary}</p>}
          {draft.sources?.length > 0 && (
            <div style={{ fontSize: 12, marginBottom: 10 }}>
              <b style={{ color: "var(--ink2)" }}>Sources:</b>{" "}
              {draft.sources.map((s, i) => <a key={i} href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", marginRight: 8 }}>{s.title?.slice(0, 24) || "source"} ↗</a>)}
            </div>
          )}
          {draft.confidence === "low" && <div style={{ fontSize: 12, color: "#9A6700", marginBottom: 8 }}>⚠️ Low confidence — verify before relying on this.</div>}
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" disabled={savingP} onClick={saveProfile}>{savingP ? "Saving…" : "Save to my book"}</button>
            <button className="mini del" onClick={() => setDraft(null)}>Discard</button>
          </div>
        </div>
      )}

      {/* confirmed accounts */}
      <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", margin: "24px 0 8px" }}>
        Your book · {initial.length}
      </div>
      {initial.length === 0 && <div style={{ fontSize: 13, color: "var(--muted)" }}>No accounts yet.</div>}
      {initial.map((a) => {
        const fs = facts[a.id];
        return (
          <div key={a.id}>
            <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: openId === a.id ? 0 : 6, padding: "10px 12px" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>{a.entity?.canonical_name || "Unknown"}{a.entity?.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {a.entity.ticker}</span> : null}</div>
                {a.entity?.hq_state && <div style={{ fontSize: 12, color: "var(--ink2)" }}>{a.entity.hq_state}</div>}
              </div>
              {a.entity?.data_tier && <TierBadge t={a.entity.data_tier} />}
              {a.entity?.id && <button className="mini" onClick={() => loadFacts(a)}>{openId === a.id ? "Hide" : "📊 Financials"}</button>}
              {a.entity?.id && <a className="mini" href={`/territory/plan/${a.entity.id}`} style={{ textDecoration: "none", display: "inline-block" }}>📄 Plan</a>}
              <button className="mini del" onClick={() => remove(a.id)}>✕</button>
            </div>
            {openId === a.id && (() => {
              const fmap: Record<string, number> = fs?.items ? Object.fromEntries(fs.items.map((i) => [i.key, i.value])) : {};
              const fyRows = FY_ROWS.filter(([k]) => fmap[k] != null);
              const balRows = BAL_ROWS.filter(([k]) => fmap[k] != null);
              const st = fs?.stock;
              const Row = ([k, label]: [string, string]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
                  <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{label}</span>
                  <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtM(fmap[k])}</span>
                </div>
              );
              return (
                <div className="card" style={{ marginTop: 0, marginBottom: 6, background: "#FBF8F2", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                  {fs?.loading && <div style={{ fontSize: 13, color: "var(--ink2)" }}>Pulling SEC data…</div>}
                  {fs?.error && <div style={{ fontSize: 13, color: "var(--red)" }}>{fs.error}</div>}
                  {fs?.items && (
                    <>
                      {/* Stock price */}
                      {st?.loading && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>Loading price…</div>}
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

                      {/* Full fiscal year */}
                      {fyRows.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 4 }}>Full fiscal year {fs.annualLabel} · $M</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px", marginBottom: 10 }}>{fyRows.map(Row)}</div>
                        </>
                      )}

                      {/* Balance sheet */}
                      {balRows.length > 0 && (
                        <>
                          <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--muted)", marginBottom: 4 }}>Balance sheet · latest ({fs.period?.replace(" · SEC EDGAR", "")}) · $M</div>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px", marginBottom: 8 }}>{balRows.map(Row)}</div>
                        </>
                      )}

                      {fyRows.length === 0 && balRows.length === 0 && <div style={{ fontSize: 13, color: "var(--ink2)" }}>No figures reported.</div>}

                      <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                        Financials as of {fs.period?.replace(" · SEC EDGAR", "")} · pulled {fmtDate(fs.asOf)}
                        {fs.source_url && <> · <a href={fs.source_url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>SEC filings ↗</a></>}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })}
    </div>
  );
}
