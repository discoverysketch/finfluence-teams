"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

// Global search (Ctrl/Cmd-K or the appbar icon): accounts, people, notes,
// signals, and app pages from one box. All queries run under the caller's RLS.
type Hit = { kind: string; icon: string; title: string; sub?: string; href: string };

const PAGES: Hit[] = [
  { kind: "page", icon: "📋", title: "Territory Board", href: "/territory/board" },
  { kind: "page", icon: "🗺️", title: "Territory Map", href: "/territory/map" },
  { kind: "page", icon: "📡", title: "Signal feed", href: "/signals" },
  { kind: "page", icon: "🔍", title: "Whitespace", href: "/territory/whitespace" },
  { kind: "page", icon: "💼", title: "CFO Simulator", href: "/territory/cfo" },
  { kind: "page", icon: "⚔️", title: "Peer Duel", href: "/territory/duel" },
  { kind: "page", icon: "🎯", title: "Challenge", href: "/challenge" },
  { kind: "page", icon: "🗂️", title: "My accounts", href: "/territory" },
];

export default function GlobalSearch() {
  const router = useRouter();
  const supabase = createClient();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const seqRef = useRef(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen(true); }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 60); else { setQ(""); setHits([]); } }, [open]);

  const run = useCallback(async (term: string) => {
    const seq = ++seqRef.current;
    const like = `%${term}%`;
    setBusy(true);
    const [accts, contacts, acts, news] = await Promise.all([
      supabase.from("accounts").select("id, entity:entities!inner(canonical_name, ticker)").or(`canonical_name.ilike.${like},ticker.ilike.${like}`, { referencedTable: "entities" }).limit(6),
      supabase.from("contacts").select("account_id, name, title").or(`name.ilike.${like},title.ilike.${like}`).limit(5),
      supabase.from("activities").select("account_id, kind, body").ilike("body", like).order("created_at", { ascending: false }).limit(4),
      supabase.from("news_items").select("headline, source_url").ilike("headline", like).order("created_at", { ascending: false }).limit(4),
    ]);
    if (seq !== seqRef.current) return; // stale response
    const out: Hit[] = [];
    for (const a of (accts.data ?? []) as any[]) out.push({ kind: "account", icon: "🏢", title: a.entity.canonical_name, sub: a.entity.ticker ?? undefined, href: `/territory/account/${a.id}` });
    for (const c of (contacts.data ?? []) as any[]) out.push({ kind: "person", icon: "👤", title: c.name, sub: c.title ?? undefined, href: `/territory/account/${c.account_id}` });
    for (const a of (acts.data ?? []) as any[]) out.push({ kind: "note", icon: "📝", title: String(a.body).slice(0, 70), sub: a.kind, href: `/territory/account/${a.account_id}` });
    for (const n of (news.data ?? []) as any[]) out.push({ kind: "signal", icon: "📰", title: String(n.headline).slice(0, 70), sub: "signal", href: "/signals" });
    const tl = term.toLowerCase();
    for (const p of PAGES) if (p.title.toLowerCase().includes(tl)) out.push(p);
    setHits(out);
    setBusy(false);
  }, [supabase]);

  useEffect(() => {
    if (!open) return;
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(() => run(q.trim()), 220);
    return () => clearTimeout(t);
  }, [q, open, run]);

  function go(h: Hit) { setOpen(false); router.push(h.href); }

  return (
    <>
      <button aria-label="Search (Ctrl+K)" onClick={() => setOpen(true)}
        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--ink2)", padding: 6, display: "inline-flex" }}>
        <Search size={18} strokeWidth={2.1} />
      </button>
      {open && (
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, background: "rgba(30,24,12,.35)", zIndex: 200, display: "flex", justifyContent: "center", alignItems: "flex-start", paddingTop: "12vh" }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ width: "min(560px, 92vw)", background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(30,24,12,.3)", overflow: "hidden" }}>
            <form onSubmit={(e) => { e.preventDefault(); if (hits[0]) go(hits[0]); }} style={{ display: "flex", alignItems: "center", gap: 10, padding: "13px 16px", borderBottom: "1px solid #F0EAE0" }}>
              <Search size={17} strokeWidth={2.2} color="#8A7E6E" />
              <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts, people, notes, signals…"
                style={{ flex: 1, border: "none", outline: "none", fontSize: 15.5, fontFamily: "inherit", background: "none" }} />
              <span style={{ fontSize: 10.5, color: "var(--muted)", border: "1px solid var(--border)", borderRadius: 5, padding: "2px 6px", fontWeight: 700 }}>esc</span>
            </form>
            <div style={{ maxHeight: "52vh", overflowY: "auto" }}>
              {q.trim().length >= 2 && !busy && hits.length === 0 && (
                <div style={{ padding: "16px", fontSize: 13.5, color: "var(--muted)" }}>Nothing found for &ldquo;{q}&rdquo;.</div>
              )}
              {hits.map((h, i) => (
                <button key={i} onClick={() => go(h)}
                  style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #F7F2E9", padding: "10px 16px", cursor: "pointer", fontFamily: "inherit" }}>
                  <span style={{ fontSize: 16 }}>{h.icon}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{h.title}</span>
                    {h.sub && <span style={{ fontSize: 11.5, color: "var(--ink2)" }}>{h.sub}</span>}
                  </span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".4px" }}>{h.kind}</span>
                </button>
              ))}
              {q.trim().length < 2 && (
                <div style={{ padding: "14px 16px", fontSize: 12.5, color: "var(--muted)" }}>
                  Type to search the whole app — try an account, a person&apos;s name, or a word from your notes. <b>Ctrl/⌘-K</b> opens this anywhere.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
