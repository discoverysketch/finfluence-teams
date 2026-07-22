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
export type Account = { id: string; rep_notes: string | null; crm_stage: string | null; owner: string | null; entity: Ent | null };
type Cand = { id: string; canonical_name: string; ticker: string | null; cik: string | null; entity_type: string | null; data_tier: string | null; hq_state: string | null; score: number; matched_alias?: string | null };
type MatchRow = { name: string; candidates: Cand[]; selectedId: string };

const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };
function TierBadge({ t }: { t: string | null }) {
  const tier = t || "?";
  return <span style={{ background: TIER_COLOR[tier] || "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px", flexShrink: 0 }}>Tier {tier}</span>;
}
type Profile = { canonical_name: string; entity_type: string; hq_state: string; ownership: string; est_size: string; segment: string; summary: string; sources: { title: string; url: string }[]; confidence: string };
type RQItem = { name: string; hint: string; status: "pending" | "running" | "done" | "error" | "saved" | "discarded"; draft?: Profile; error?: string };
const TYPE_LABEL: Record<string, string> = { iou: "Investor-owned utility", ipp: "Independent power producer", coop: "Cooperative", muni: "Municipal", retailer: "Retailer", other: "Other" };

// Fire-and-forget background people research for freshly added accounts.
// 3 at a time so a bulk add doesn't slam the API; keepalive lets in-flight
// requests finish even if the user navigates away. Results are staged on the
// account and reviewed in the Hub — nothing is added without approval.
const RESEARCH_CAP = 25; // big CSV drops: research the first 25, Hub button covers the rest
function kickPeopleResearch(accountIds: string[]) {
  const queue = accountIds.slice(0, RESEARCH_CAP);
  let i = 0;
  const next = (): void => {
    if (i >= queue.length) return;
    const accountId = queue[i++];
    fetch("/api/research-people", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId }), keepalive: true,
    }).catch(() => {}).finally(next);
  };
  for (let k = 0; k < 3; k++) next();
}

export default function Territory({ listId, userId, emailOf, initial }: { listId: string; userId: string; emailOf: Record<string, string>; initial: Account[] }) {
  const [scope, setScope] = useState<"all" | "mine">("all");
  const supabase = createClient();
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(initial.length === 0);
  const [names, setNames] = useState("");
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [parseNote, setParseNote] = useState("");
  // Research queue: names the directory doesn't know (munis, co-ops, privates)
  // get web-researched one by one after the matched ones save — the user never
  // has to know which bucket a name belongs to.
  const [rq, setRq] = useState<RQItem[] | null>(null);
  const [rqBusy, setRqBusy] = useState(false);
  const [rqElapsed, setRqElapsed] = useState(0);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);

  const existingIds = new Set(initial.map((a) => a.entity?.id).filter(Boolean));

  // Names contain commas ("NRG Energy, Inc."), so split on newlines when
  // present — and ALWAYS on tabs (copying an Excel row/grid yields tab-separated
  // text with no newlines). Commas only separate single-line pastes. Entries
  // longer than any plausible company name are merged text — skip, never match.
  function parseNames(text: string): { list: string[]; dupes: number; truncated: number; blobs: number } {
    // Line endings vary by source: \r\n (Windows), \n (Unix), \r alone
    // (Excel-for-Mac CSVs — the sneaky one). Tabs = Excel row/grid copies.
    const raw = /[\r\n]/.test(text)
      ? text.split(/\r\n|\r|\n/).flatMap((l) => l.split("\t"))
      : text.includes("\t") ? text.split("\t") : text.split(",");
    const seen = new Set<string>();
    const list: string[] = [];
    let dupes = 0, blobs = 0;
    for (const s0 of raw) {
      const s = s0.trim().replace(/^"(.*)"$/s, "$1").trim();
      if (s.length < 2) continue;
      if (s.length > 80) { blobs++; continue; } // merged cells / run-together text
      const k = s.toLowerCase();
      if (seen.has(k)) { dupes++; continue; }
      seen.add(k); list.push(s);
    }
    const truncated = Math.max(0, list.length - 200);
    return { list: list.slice(0, 200), dupes, truncated, blobs };
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
    reader.onload = () => setNames(String(reader.result || "").split(/\r\n|\r|\n/).map(firstCol).join("\n"));
    reader.readAsText(f);
  }

  async function match() {
    const { list, dupes, truncated, blobs } = parseNames(names);
    if (!list.length) {
      if (!blobs) { setMsg("Paste at least one account name."); return; }
      // Merged-cell paste (no separators at all): let the model split it, then
      // flow into the normal match-and-review pipeline.
      setBusy(true); setMsg(""); setParseNote("Merged text detected — splitting it into names…");
      try {
        const r = await fetch("/api/split-names", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: names }) });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.names?.length) {
          setMsg(j?.error || "Couldn't split that text — paste one company name per line."); setParseNote("");
          return;
        }
        setNames(j.names.join("\n"));
        setParseNote(`Split merged text into ${j.names.length} names`);
        await matchList(j.names.slice(0, 200));
      } catch { setMsg("Network error."); }
      finally { setBusy(false); }
      return;
    }
    setBusy(true); setMsg("");
    setParseNote([
      dupes ? `${dupes} exact duplicate${dupes === 1 ? "" : "s"} removed` : "",
      truncated ? `first 200 kept (${truncated} over the limit skipped)` : "",
      blobs ? `${blobs} merged-text entr${blobs === 1 ? "y" : "ies"} skipped (one name per line works best)` : "",
    ].filter(Boolean).join(" · "));
    try {
      await matchList(list);
    } catch { setMsg("Matching failed — is the directory loaded?"); }
    finally { setBusy(false); }
  }

  async function matchList(list: string[]) {
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
    // Names with no directory candidates (or where the rep picked "none of
    // these") flow into the research queue — munis/co-ops/privates, sorted for
    // the user instead of by the user.
    const unmatched = rows.filter((r) => r.candidates.length === 0 || r.selectedId === "none").map((r) => r.name);
    if (!ids.length && !unmatched.length) { setMsg("Nothing new to add — pick at least one match."); return; }
    setBusy(true); setMsg("");
    if (ids.length) {
      const { data: created, error } = await supabase.from("accounts").insert(ids.map((entity_id) => ({ list_id: listId, entity_id, owner: userId }))).select("id");
      if (error) { setBusy(false); setMsg(error.message); return; }
      if (created?.length) kickPeopleResearch(created.map((r) => r.id));
      router.refresh();
    }
    setBusy(false);
    setRows(null); setNames(""); setParseNote("");
    if (unmatched.length) {
      runQueue(unmatched.map((name) => ({ name, hint: "", status: "pending" as const })));
    } else {
      setShowAdd(false);
    }
  }

  // One web-research pass (streamed NDJSON) -> profile draft, or throws.
  async function researchOne(name: string, hint: string): Promise<Profile> {
    const r = await fetch("/api/entity-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, hint }) });
    if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || "Research failed."); }
    const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        let ev: any; try { ev = JSON.parse(line); } catch { continue; } // eslint-disable-line @typescript-eslint/no-explicit-any
        if (ev.stage === "done") return ev.profile as Profile;
        if (ev.stage === "error") throw new Error(ev.error || "Research failed.");
      }
    }
    throw new Error("Research ran long — retry, ideally with a state or parent hint.");
  }

  async function runQueue(items: RQItem[]) {
    setRq(items); setRqBusy(true);
    for (let i = 0; i < items.length; i++) {
      setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "running" } : x)));
      const t0 = Date.now();
      const tick = setInterval(() => setRqElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
      try {
        const draft = await researchOne(items[i].name, items[i].hint);
        setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "done", draft } : x)));
      } catch (e) {
        setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "error", error: (e as Error).message } : x)));
      } finally { clearInterval(tick); setRqElapsed(0); }
    }
    setRqBusy(false);
  }

  async function retryItem(i: number) {
    if (rqBusy || !rq) return;
    const item = rq[i];
    setRqBusy(true);
    setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "running", error: undefined } : x)));
    const t0 = Date.now();
    const tick = setInterval(() => setRqElapsed(Math.round((Date.now() - t0) / 1000)), 1000);
    try {
      const draft = await researchOne(item.name, item.hint);
      setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "done", draft } : x)));
    } catch (e) {
      setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "error", error: (e as Error).message } : x)));
    } finally { clearInterval(tick); setRqElapsed(0); setRqBusy(false); }
  }

  async function saveDraft(i: number) {
    const item = rq?.[i];
    if (!item?.draft || !listId) return;
    setSavingIdx(i); setMsg("");
    try {
      const r = await fetch("/api/save-profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile: item.draft, listId }) });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || "Save failed."); return; }
      if (j.accountId) kickPeopleResearch([j.accountId]);
      setRq((q) => q!.map((x, jx) => (jx === i ? { ...x, status: "saved" } : x)));
      router.refresh();
    } catch { setMsg("Network error."); }
    finally { setSavingIdx(null); }
  }

  const matched = rows?.filter((r) => r.selectedId !== "none").length ?? 0;

  return (
    <div>
      {msg && <div className="card" style={{ borderColor: "var(--red)", color: "var(--red)", marginBottom: 12 }}>{msg}</div>}

      {/* ---------- The book ---------- */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "4px 0 8px", gap: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px" }}>
          {scope === "mine" ? "My accounts" : "Team book"} · {initial.filter((a) => scope === "all" || a.owner === userId).length}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <button className="mini" onClick={() => setScope("all")} style={{ fontWeight: 700, background: scope === "all" ? "var(--cream2)" : "#fff" }}>All</button>
          <button className="mini" onClick={() => setScope("mine")} style={{ fontWeight: 700, background: scope === "mine" ? "var(--cream2)" : "#fff" }}>Mine</button>
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
          {!rows && !rq && (
            <>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, cursor: "pointer", background: "#fff", border: "1.5px dashed var(--border)", borderRadius: 10, padding: "10px 14px", fontSize: 13, fontWeight: 700, color: "var(--ink2)", marginBottom: 10 }}>
                <Paperclip size={15} strokeWidth={2.2} /> Upload a CSV
                <input type="file" accept=".csv,.txt" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
              </label>
              <textarea value={names} onChange={(e) => setNames(e.target.value)} rows={5} placeholder={"NextEra Energy\nDuke Energy\nPedernales Electric Cooperative\nJEA\n…one per line — public, muni, co-op, private, all in one list"}
                style={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, padding: 8, fontFamily: "inherit", fontSize: 14 }} />
              <button className="btn" style={{ marginTop: 10 }} disabled={busy || names.trim().length < 2} onClick={match}>
                {busy ? "Matching…" : "Match accounts"}
              </button>
              <p style={{ fontSize: 11.5, color: "var(--muted)", margin: "8px 0 0" }}>
                Mix freely — known companies match instantly; anything the directory doesn&apos;t know gets web-researched for you.
              </p>
            </>
          )}

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
                      <div style={{ fontSize: 13, color: "#9A6700", fontWeight: 600 }}>🔍 Not in the directory (likely muni/co-op/private) — will be web-researched after you confirm.</div>
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
              {(() => {
                const nMatch = uniqueToAdd(rows).length;
                const nResearch = rows.filter((r) => r.candidates.length === 0 || r.selectedId === "none").length;
                return (
                  <button className="btn" disabled={busy || (!nMatch && !nResearch)} onClick={confirm} style={{ marginTop: 4 }}>
                    {busy ? "Saving…" : `Confirm — save ${nMatch} matched${nResearch ? ` · research ${nResearch} unmatched` : ""}`}
                  </button>
                );
              })()}
            </div>
          )}

          {rq && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
                  <Search size={13} strokeWidth={2.2} style={{ verticalAlign: "-2px" }} /> Researching unmatched names · {rq.filter((x) => ["done", "saved", "discarded", "error"].includes(x.status)).length} of {rq.length} done
                  {rqBusy && <span style={{ color: "var(--muted)", fontWeight: 500 }}> · ~1-2 min each, review as they land</span>}
                </div>
                {!rqBusy && (
                  <button className="mini" onClick={() => { setRq(null); setShowAdd(false); router.refresh(); }}>Done</button>
                )}
              </div>
              {rq.map((item, i) => (
                <div key={i} className="card" style={{ marginBottom: 8, padding: "12px 14px", opacity: item.status === "discarded" ? 0.6 : 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ flex: 1, fontWeight: 700, fontSize: 14.5 }}>{item.name}</div>
                    {item.status === "pending" && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>queued</span>}
                    {item.status === "running" && <span style={{ fontSize: 12, color: "#9A6700", fontWeight: 700 }}>researching… {rqElapsed}s</span>}
                    {item.status === "saved" && <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 700 }}>✓ added to book</span>}
                    {item.status === "discarded" && <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>discarded</span>}
                  </div>
                  {item.status === "error" && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ fontSize: 12.5, color: "var(--red)", marginBottom: 6 }}>{item.error}</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <input value={item.hint} onChange={(e) => setRq((q) => q!.map((x, j) => (j === i ? { ...x, hint: e.target.value } : x)))}
                          placeholder="Hint — state, parent company…" style={{ flex: 1, fontSize: 12.5 }} />
                        <button className="mini" disabled={rqBusy} onClick={() => retryItem(i)}>Retry</button>
                      </div>
                    </div>
                  )}
                  {item.status === "done" && item.draft && (
                    <div style={{ marginTop: 8 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                        <div style={{ flex: 1, fontWeight: 800, fontSize: 14 }}>{item.draft.canonical_name}</div>
                        <TierBadge t="D" />
                        <span style={{ fontSize: 10, fontWeight: 700, color: "#fff", background: item.draft.confidence === "high" ? "var(--green)" : item.draft.confidence === "medium" ? "var(--gold)" : "#8A7E6E", borderRadius: 4, padding: "2px 6px" }}>{item.draft.confidence} confidence</span>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px", fontSize: 12.5, marginBottom: 6 }}>
                        {item.draft.entity_type && (<><b style={{ color: "var(--ink2)" }}>Type</b><span>{TYPE_LABEL[item.draft.entity_type] || item.draft.entity_type}</span></>)}
                        {item.draft.hq_state && (<><b style={{ color: "var(--ink2)" }}>HQ</b><span>{item.draft.hq_state}</span></>)}
                        {item.draft.ownership && (<><b style={{ color: "var(--ink2)" }}>Ownership</b><span>{item.draft.ownership}</span></>)}
                        {item.draft.est_size && (<><b style={{ color: "var(--ink2)" }}>Size</b><span>{item.draft.est_size}</span></>)}
                      </div>
                      {item.draft.summary && <p style={{ fontSize: 13, lineHeight: 1.5, margin: "0 0 8px" }}>{item.draft.summary}</p>}
                      {item.draft.sources?.length > 0 && (
                        <div style={{ fontSize: 11.5, marginBottom: 8 }}>
                          {item.draft.sources.map((s, si) => <a key={si} href={s.url} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", marginRight: 8 }}>{s.title?.slice(0, 24) || "source"} ↗</a>)}
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 8 }}>
                        <button className="btn" style={{ padding: "8px 14px", fontSize: 13 }} disabled={savingIdx === i} onClick={() => saveDraft(i)}>{savingIdx === i ? "Saving…" : "Save to book"}</button>
                        <button className="mini del" onClick={() => setRq((q) => q!.map((x, j) => (j === i ? { ...x, status: "discarded" } : x)))}>Discard</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ---------- Account rows: tap through to the Hub ---------- */}
      {initial.length === 0 && !showAdd && <div style={{ fontSize: 13, color: "var(--muted)" }}>No accounts yet.</div>}
      {initial.filter((a) => scope === "all" || a.owner === userId)
        .slice().sort((a, b) => (a.entity?.canonical_name ?? "").localeCompare(b.entity?.canonical_name ?? "", "en", { sensitivity: "base" }))
        .map((a) => (
        <Link key={a.id} href={`/territory/account/${a.id}`} style={{ color: "inherit", display: "block" }}>
          <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "12px 14px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {a.entity?.canonical_name || "Unknown"}{a.entity?.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {a.entity.ticker}</span> : null}
              </div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 2 }}>
                {a.crm_stage ? <span style={{ background: "#EEF4FB", color: "var(--blue)", borderRadius: 4, padding: "1px 7px", fontWeight: 700, fontSize: 11, marginRight: 6 }}>{a.crm_stage.replace("_", " ")}</span> : null}
                {a.owner && a.owner !== userId && emailOf[a.owner] && (
                  <span style={{ background: "#F4EFE6", color: "#8A7E6E", borderRadius: 4, padding: "1px 7px", fontWeight: 700, fontSize: 11, marginRight: 6 }}>{emailOf[a.owner].split("@")[0]}</span>
                )}
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
