import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { rankPeers } from "@/lib/lookalike";
import type { FactMap } from "@/lib/facts";
import AddToBook from "./AddToBook";

// Whitespace (SPEC 7b application 3): directory entities that resemble the
// accounts you already cover but aren't in your book — a prospecting list with
// the "why" attached. Candidates = every entity with cached SEC facts.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function WhitespacePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("entity_id").eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
  const bookIds = new Set(((accts ?? []) as any[]).map((a) => a.entity_id).filter(Boolean));

  // All cached facts, grouped per entity (RLS: shared + own tenant's).
  const { data: fr } = await supabase.from("entity_facts").select("entity_id, fact_key, value").eq("source", "sec");
  const byE: Record<string, FactMap> = {};
  for (const r of (fr ?? []) as any[]) {
    if (String(r.fact_key).startsWith("fy_")) continue;
    (byE[r.entity_id] ??= {})[r.fact_key] = Number(r.value);
  }
  const targets = [...bookIds].filter((id) => byE[id as string] && Object.keys(byE[id as string]).length >= 3) as string[];
  const candidates = Object.keys(byE).filter((id) => !bookIds.has(id) && Object.keys(byE[id]).length >= 3);

  if (!targets.length || !candidates.length) {
    return (
      <Shell active="accounts" isAdmin={isAdmin}>
        <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
        <h1>White<span style={{ color: "var(--red)" }}>space</span></h1>
        <div className="card">
          {!targets.length
            ? <>Add some SEC-listed accounts first (and open their 📊 Financials once) — whitespace ranks lookalikes against <i>your</i> book.</>
            : <>No candidate universe cached yet — an admin can run <code>npm run cache-peers</code>.</>}
        </div>
      </Shell>
    );
  }

  const { data: meta } = await supabase.from("entities")
    .select("id, canonical_name, ticker, data_tier, hq_state").in("id", [...targets, ...candidates]);
  const entOf: Record<string, any> = {};
  for (const e of (meta ?? []) as any[]) entOf[e.id] = e;

  // For each candidate: best similarity to ANY of the book's accounts + which one.
  const best: Record<string, { sim: number; likeId: string }> = {};
  for (const t of targets) {
    const ranked = rankPeers(byE[t], candidates.map((id) => ({ id, facts: byE[id] })));
    for (const r of ranked) {
      const s = Math.round(r.similarity * 100);
      if (!best[r.id] || s > best[r.id].sim) best[r.id] = { sim: s, likeId: t };
    }
  }
  const rows = candidates
    .filter((id) => entOf[id])
    .map((id) => ({ id, ...best[id], e: entOf[id] }))
    .sort((a, b) => (b.sim ?? 0) - (a.sim ?? 0))
    .slice(0, 12);

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <h1>White<span style={{ color: "var(--red)" }}>space</span></h1>
      <div className="seg" style={{ margin: "10px 0 12px" }}>
        <Link href="/territory">Book</Link>
        <Link href="/territory/board">Board</Link>
        <Link href="/territory/map">Map</Link>
        <Link href="/territory/whitespace" className="on">Whitespace</Link>
      </div>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Companies that look like the accounts you already cover — but aren&apos;t in your book. Ranked on real financial similarity (size, leverage, capex, cash generation).
      </p>
      {rows.map((r) => (
        <div key={r.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "11px 13px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.e.canonical_name}{r.e.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {r.e.ticker}</span> : null}</div>
            <div style={{ fontSize: 12, color: "var(--ink2)" }}>
              {r.sim}% like <b>{entOf[r.likeId]?.canonical_name ?? "your book"}</b>{r.e.hq_state ? ` · ${r.e.hq_state}` : ""}
            </div>
          </div>
          <AddToBook listId={list!.id} entityId={r.id} />
        </div>
      ))}
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 12 }}>Candidates come from the cached fact universe — it grows as your team views financials and as the peer cache is warmed.</p>
    </Shell>
  );
}
