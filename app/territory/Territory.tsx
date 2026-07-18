"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, X, Paperclip, ChevronRight, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// My Accounts: the book front and center; all intake (public match + private
// research) lives behind one "+ Add accounts" panel. Everything about a single
// account (financials, plan, people, remove) lives in its Account Hub.
type Ent = { id: string; canonical_name: string; ticker: string | null; data_tier: string | null; entity_type: string | null; hq_state: string | null };
export type Account = { id: string; rep_notes: string | null; crm_stage: string | null; entity: Ent | null };
type Cand = { id: string; canonical_name: string; ticker: string | null; cik: string | null; entity_type: string | null; data_tier: string | null; hq_state: string | null; score: number; matched_alias?: string | null };
type MatchRow = { name: string; candidates: Cand[]; selectedId: string };

const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };
function TierBadge({ t }: { t: string | null }) {
  const tier = t || "?";
  return <span style={{ background: TIER_COLOR[tier] || "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>Tier {tier}</span>;
}
type Profile = { canonical_name: string; entity_type: string; hq_state: string; ownership: string; est_size: string; segment: string; summary: string; sources: { title: string; url: string }[]; confidence: string };
const TYPE_LABEL: Record<string, string> = { iou: "Investor-owned utility", ipp: "Independent power producer", coop: "Cooperative", muni: "Municipal", retailer: "Retailer", other: "Other" };

export default function Territory({ listId, initial }: { listId: string; initial: Account[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(initial.length === 0);
  const [addMode, setAddMode] = useState<"public" | "private">("public");
  const [names, setNames] = useState("");
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [parseNote, setParseNote] = useState("");
  const [pName, setPName] = useState("");
  const [pHint, setPHint] = useState("");
  const [researching, setResearching] = useState(false);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [savingP, setSavingP] = useState(false);
  const [stage, setStage] = useState("");
  const [prog, setProg] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const existingIds = new Set(initial.map((a) => a.entity?.id).filter(Boolean));

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
          // wrong company; fuzzy ALIAS hits need a higher bar (similarly-named
          // subsidiaries of different parents can cross-match).
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
    setRows(null); setNames(""); setParseNote(""); setShowAdd(false); router.refresh();
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
          let ev: any; try { ev = JSON.parse(line); } catch { continue; } // eslint-disable-line @typescript-eslint/no-explicit-any
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
      setDraft(null); setPName(""); setPHint(""); setShowAdd(false); router.refresh();
    } catch { setMsg("Network error."); }
    finally { setSavingP(false); }
  }

  const matched = rows?.filter((r) => r.selectedId !== "none").length ?? 0;

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}

      {/* ---------- The book ---------- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 8px" }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px" }}>
          Your book · {initial.length}
        </div>
        {!showAdd && (
          <button className="btn btn-i" style={{ padding: "7px 13px", fontSize: 13 }} onClick={() => setShowAdd(true)}>
            <Plus size={15} strokeWidth={2.4} /> Add accounts
          </button>
        )}
      </div>

      {/* ---------- Add panel (collapsed by default) ---------- */}
      {showAdd && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <div style={{ fontWeight: 800, fontSize: 15 }}>Add accounts</div>
            {initial.length > 0 && (
              <button className="mini" aria-label="Close" onClick={() => { setShowAdd(false); setRows(null); setMsg(""); setParseNote(""); }}><X size={14} /></button>
            )}
          </div>
          <div className="seg" style={{ marginBottom: 12 }}>
            <button className={addMode === "public" ? "on" : ""} onClick={() => setAddMode("public")}>Public (SEC)</button>
            <button className={addMode === "private" ? "on" : ""} onClick={() => setAddMode("private")}>Private / muni</button>
          </div>

          {addMode === "public" && !rows && (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "#fff", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 10 }}>
                <Paperclip size={15} strokeWidth={2.2} /> Upload a CSV
                <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={5} placeholder={"NextEra Energy\nDuke Energy\nAEP\n…one per line, names or tickers"}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 14 }} />
              <button className="btn" style={{ marginTop: 10 }} disabled={busy || names.trim().length < 2} onClick={match}>
                {busy ? "Matching…" : "Match accounts"}
              </button>
            </>
          )}

          {addMode === "public" && rows && (
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
                      <div style={{ fontSize: 13, color: "var(--muted)" }}>No directory match — try the &quot;Private / muni&quot; tab instead.</div>
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

          {addMode === "private" && (
            <>
              <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
                Co-op, municipal, private IPP, retailer? Claude web-researches a <b>sourced</b> profile you review before saving. Can take up to ~2 minutes.
              </p>
              <input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Company name, e.g. Pedernales Electric Cooperative" style={{ marginBottom: 8 }} />
              <input value={pHint} onChange={(e) => setPHint(e.target.value)} placeholder="Optional hint — state, parent company…" style={{ marginBottom: 8 }} disabled={researching} />
              <button className="btn btn-i" disabled={researching || pName.trim().length < 2} onClick={research}>
                <Search size={15} strokeWidth={2.2} /> {researching ? "Researching…" : "Research"}
              </button>
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

              {draft && (
                <div className="card" style={{ marginTop: 10 }}>
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
                  {draft.confidence === "low" && <div style={{ fontSize: 12, color: "#9A6700", marginBottom: 8 }}>⚠ Low confidence — verify before relying on this.</div>}
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" disabled={savingP} onClick={saveProfile}>{savingP ? "Saving…" : "Save to my book"}</button>
                    <button className="mini del" onClick={() => setDraft(null)}>Discard</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ---------- Account rows: tap through to the Hub ---------- */}
      {initial.length === 0 && !showAdd && <div style={{ fontSize: 13, color: "var(--muted)" }}>No accounts yet.</div>}
      {initial.map((a) => (
        <Link key={a.id} href={`/territory/account/${a.id}`} style={{ color: "inherit", display: "block" }}>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "12px 14px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.entity?.canonical_name || "Unknown"}{a.entity?.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {a.entity.ticker}</span> : null}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                {a.crm_stage ? <span style={{ background: "#EEF4FB", color: "var(--blue)", borderRadius: 4, padding: "1px 7px", fontWeight: 700, fontSize: 11, marginRight: 6 }}>{a.crm_stage.replace("_", " ")}</span> : null}
                {a.entity?.hq_state || ""}
              </div>
            </div>
            <TierBadge t={a.entity?.data_tier ?? null} />
            <ChevronRight size={17} strokeWidth={2} color="#8A7E6E" style={{ flexShrink: 0 }} />
          </div>
        </Link>
      ))}
    </div>
  );
}
