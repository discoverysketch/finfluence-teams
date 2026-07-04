"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Ent = { id: string; canonical_name: string; ticker: string | null; data_tier: string | null; entity_type: string | null; hq_state: string | null };
export type Account = { id: string; rep_notes: string | null; crm_stage: string | null; entity: Ent | null };
type Cand = { id: string; canonical_name: string; ticker: string | null; cik: string | null; entity_type: string | null; data_tier: string | null; hq_state: string | null; score: number };
type MatchRow = { name: string; candidates: Cand[]; selectedId: string };

const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };
function TierBadge({ t }: { t: string | null }) {
  const tier = t || "?";
  return <span style={{ background: TIER_COLOR[tier] || "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Tier {tier}</span>;
}

const LABELS: Record<string, string> = {
  revenue: "Revenue", operatingIncome: "Operating income", netIncome: "Net income", interestExpense: "Interest expense",
  totalAssets: "Total assets", totalLiabilities: "Total liabilities", totalEquity: "Total equity",
  cash: "Cash", currentAssets: "Current assets", currentLiabilities: "Current liabilities",
  totalDebt: "Total debt", operatingCashFlow: "Op. cash flow", capex: "Capex", cogs: "COGS",
};
function fmtM(v: number) {
  const a = Math.abs(v);
  if (a >= 1000) return `${v < 0 ? "-" : ""}$${(a / 1000).toFixed(1)}B`;
  return `${v < 0 ? "-" : ""}$${Math.round(a)}M`;
}
type FactState = { loading?: boolean; error?: string; company?: string; period?: string; source_url?: string; items?: { key: string; value: number }[] };

export default function Territory({ listId, initial }: { listId: string; initial: Account[] }) {
  const supabase = createClient();
  const router = useRouter();
  const [names, setNames] = useState("");
  const [rows, setRows] = useState<MatchRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [facts, setFacts] = useState<Record<string, FactState>>({});

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
      setFacts((f) => ({ ...f, [a.id]: { company: j.company, period: j.period, source_url: j.source_url, items: j.facts } }));
    } catch { setFacts((f) => ({ ...f, [a.id]: { error: "Network error." } })); }
  }

  function parseNames(text: string): string[] {
    const seen = new Set<string>();
    return text.split(/[\n,]/).map((s) => s.trim()).filter((s) => {
      if (s.length < 2) return false;
      const k = s.toLowerCase();
      if (seen.has(k)) return false; seen.add(k); return true;
    }).slice(0, 60);
  }

  function onFile(f: File | undefined) {
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      // take the first column of each CSV line
      const text = String(reader.result || "").split(/\r?\n/).map((l) => l.split(",")[0]).join("\n");
      setNames(text);
    };
    reader.readAsText(f);
  }

  async function match() {
    const list = parseNames(names);
    if (!list.length) { setMsg("Paste at least one account name."); return; }
    setBusy(true); setMsg("");
    try {
      const out: MatchRow[] = [];
      for (const name of list) {
        const { data } = await supabase.rpc("match_entities", { q: name, lim: 6 });
        const candidates = (data ?? []) as Cand[];
        out.push({ name, candidates, selectedId: candidates[0]?.id ?? "none" });
      }
      setRows(out);
    } catch { setMsg("Matching failed — is the directory loaded?"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!rows) return;
    const toAdd = rows
      .filter((r) => r.selectedId && r.selectedId !== "none" && !existingIds.has(r.selectedId))
      .map((r) => ({ list_id: listId, entity_id: r.selectedId }));
    if (!toAdd.length) { setMsg("Nothing new to add — pick at least one match."); return; }
    setBusy(true);
    const { error } = await supabase.from("accounts").insert(toAdd);
    setBusy(false);
    if (error) { setMsg(error.message); return; }
    setRows(null); setNames(""); router.refresh();
  }

  async function remove(id: string) {
    if (!window.confirm("Remove this account?")) return;
    await supabase.from("accounts").delete().eq("id", id);
    router.refresh();
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
            <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>{matched} of {rows.length} matched · review below</div>
            <button className="mini" onClick={() => { setRows(null); setMsg(""); }}>← Start over</button>
          </div>
          {rows.map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, padding: "12px 14px" }}>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>{r.name}</div>
              {r.candidates.length === 0 ? (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>No directory match. It&apos;ll be skipped (private-profile flow coming soon).</div>
              ) : (
                <select value={r.selectedId} onChange={(e) => setRows((rs) => rs!.map((x, j) => j === i ? { ...x, selectedId: e.target.value } : x))}
                  style={{ width: "100%", padding: "8px 10px", fontSize: 13.5 }}>
                  {r.candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.canonical_name}{c.ticker ? ` (${c.ticker})` : ""} · Tier {c.data_tier || "?"} · {Math.round(c.score * 100)}% match
                    </option>
                  ))}
                  <option value="none">— None of these —</option>
                </select>
              )}
            </div>
          ))}
          <button className="btn" disabled={busy} onClick={confirm} style={{ marginTop: 4 }}>
            {busy ? "Saving…" : `Confirm & save ${rows.filter((r) => r.selectedId !== "none" && !existingIds.has(r.selectedId)).length} account(s)`}
          </button>
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
              <button className="mini del" onClick={() => remove(a.id)}>✕</button>
            </div>
            {openId === a.id && (
              <div className="card" style={{ marginTop: 0, marginBottom: 6, background: "#FBF8F2", borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                {fs?.loading && <div style={{ fontSize: 13, color: "var(--ink2)" }}>Pulling SEC data…</div>}
                {fs?.error && <div style={{ fontSize: 13, color: "var(--red)" }}>{fs.error}</div>}
                {fs?.items && (
                  <>
                    <div style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600, marginBottom: 6 }}>{fs.period} · $ millions</div>
                    {fs.items.length === 0 ? (
                      <div style={{ fontSize: 13, color: "var(--ink2)" }}>No figures reported.</div>
                    ) : (
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "3px 16px" }}>
                        {fs.items.map((it) => (
                          <div key={it.key} style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #F0EAE0", padding: "3px 0" }}>
                            <span style={{ fontSize: 12.5, color: "var(--ink2)" }}>{LABELS[it.key] || it.key}</span>
                            <span style={{ fontSize: 13, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>{fmtM(it.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {fs.source_url && <a href={fs.source_url} target="_blank" rel="noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 12, color: "var(--blue)", fontWeight: 700 }}>SEC filings ↗</a>}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
