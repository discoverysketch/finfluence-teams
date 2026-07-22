import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { CONCEPTS, conceptScores, overallAcumen, tier, heatColor, type Ev } from "@/lib/acumen";

type Member = { id: string; email: string; role: string };
/* eslint-disable @typescript-eslint/no-explicit-any */
const STAGES: [string, string][] = [
  ["prospect", "Prospect"], ["discovery", "Discovery"], ["evaluation", "Evaluation"],
  ["proposal", "Proposal"], ["negotiation", "Negotiation"], ["closed_won", "Won"], ["closed_lost", "Lost"],
];

export default async function ManagerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "manager") {
    return <Shell active="home" isAdmin={false}><h1>Team dashboard</h1><div className="card">Managers and admins only.</div></Shell>;
  }

  const [{ data: memberData }, { data: progData }, { data: evData }, { data: acctData }, { data: actData }] = await Promise.all([
    supabase.from("users").select("id,email,role").eq("tenant_id", me.tenant_id).order("email"),
    // Seeded (core) cards only — custom concepts are practice-only and don't count.
    supabase.from("progress").select("user_id, cards!inner(is_seeded)").eq("status", "mastered").eq("cards.is_seeded", true),
    supabase.from("score_events").select("user_id,concept_tag,correct"),
    supabase.from("accounts").select("id, crm_stage, owner, deal_value, entity:entities(canonical_name, ticker)"),
    supabase.from("activities").select("account_id, user_id, kind, done, created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  const members = (memberData ?? []) as Member[];
  const mastered = (progData ?? []) as { user_id: string }[];
  const events = (evData ?? []) as (Ev & { user_id: string })[];

  const masteredBy: Record<string, number> = {};
  mastered.forEach((p) => { masteredBy[p.user_id] = (masteredBy[p.user_id] || 0) + 1; });
  const evBy: Record<string, Ev[]> = {};
  events.forEach((e) => { (evBy[e.user_id] = evBy[e.user_id] || []).push(e); });

  const acumenOf = (uid: string) => overallAcumen(evBy[uid] || [], masteredBy[uid] || 0);
  const teamAcumen = members.length ? Math.round(members.reduce((n, m) => n + acumenOf(m.id), 0) / members.length) : 0;
  const totalMastered = mastered.length;

  // ---- pipeline / stalled / activity (CRM roll-up) ----
  const emailOf: Record<string, string> = {};
  for (const m of members) emailOf[m.id] = m.email;
  const short = (id: string | null) => (id && emailOf[id] ? emailOf[id].split("@")[0] : null);
  const accts = (acctData ?? []) as any[];
  const acts = (actData ?? []) as any[];
  const byStage: Record<string, any[]> = {};
  for (const a of accts) (byStage[a.crm_stage || "prospect"] ??= []).push(a);

  // Dollars: sum per stage + probability-weighted total (standard stage odds).
  const STAGE_ODDS: Record<string, number> = { prospect: 0.1, discovery: 0.25, evaluation: 0.4, proposal: 0.6, negotiation: 0.8, closed_won: 1, closed_lost: 0 };
  const fmtK = (v: number) => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
  const stageSum = (k: string) => (byStage[k] ?? []).reduce((n, a) => n + (Number(a.deal_value) || 0), 0);
  const weighted = accts.reduce((n, a) => n + (Number(a.deal_value) || 0) * (STAGE_ODDS[a.crm_stage || "prospect"] ?? 0.1), 0);
  const wonTotal = stageSum("closed_won");
  const valuedCount = accts.filter((a) => Number(a.deal_value) > 0).length;

  const lastTouch: Record<string, string> = {};
  for (const a of acts) if (!lastTouch[a.account_id]) lastTouch[a.account_id] = a.created_at; // acts are newest-first
  const now = Date.now();
  const open = accts.filter((a) => !String(a.crm_stage || "").startsWith("closed"));
  // Stalled = had activity, then went quiet. Never-touched accounts are a
  // count, not a list (early on that's most of the book — a list would be noise).
  const stalled = open
    .filter((a) => lastTouch[a.id])
    .map((a) => ({ ...a, days: Math.floor((now - +new Date(lastTouch[a.id])) / 86400000) }))
    .filter((a) => a.days >= 21)
    .sort((a, b) => b.days - a.days)
    .slice(0, 8);
  const neverTouched = open.filter((a) => !lastTouch[a.id]).length;

  const weekAgo = now - 7 * 86400000;
  const weekActs = acts.filter((a) => +new Date(a.created_at) >= weekAgo);
  const actBy: Record<string, { touch: number; tasksDone: number }> = {};
  for (const a of weekActs) {
    const s = (actBy[a.user_id] ??= { touch: 0, tasksDone: 0 });
    if (a.kind === "task") { if (a.done) s.tasksDone++; } else s.touch++;
  }

  const Stat = ({ n, l }: { n: string; l: string }) => (
    <div className="card" style={{ flex: 1, textAlign: "center", padding: 12 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--red)" }}>{n}</div>
      <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
    </div>
  );

  return (
    <Shell active="home" isAdmin={me.role === "admin"}>
      <h1>Team <span style={{ color: "var(--red)" }}>dashboard</span></h1>

      <div style={{ display: "flex", gap: 8 }}>
        <Stat n={String(members.length)} l="members" />
        <Stat n={String(teamAcumen)} l="team acumen" />
        <Stat n={String(totalMastered)} l="cards mastered" />
      </div>

      <div className="secttl">Pipeline · {accts.length} accounts{valuedCount > 0 ? ` · ${fmtK(weighted)} weighted · ${fmtK(wonTotal)} won` : ""}</div>
      {valuedCount === 0 && (
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: "0 0 8px" }}>
          No deal values yet — set &ldquo;Deal $&rdquo; on account pages and this becomes a weighted $ pipeline.
        </p>
      )}
      <div style={{ display: "flex", gap: 6, overflowX: "auto", paddingBottom: 4 }}>
        {STAGES.map(([k, label]) => {
          const rows = byStage[k] ?? [];
          return (
            <div key={k} style={{ minWidth: 128, flex: 1, background: "#fff", border: "1px solid var(--border)", borderRadius: 10, padding: "8px 9px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
                <span style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".4px", color: k === "closed_won" ? "var(--green)" : k === "closed_lost" ? "var(--muted)" : "var(--ink2)" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 800 }}>{rows.length}{stageSum(k) > 0 ? <span style={{ fontSize: 10.5, color: "var(--ink2)", fontWeight: 700 }}> · {fmtK(stageSum(k))}</span> : null}</span>
              </div>
              {rows.slice(0, 6).map((a) => (
                <Link key={a.id} href={`/territory/account/${a.id}`} style={{ color: "inherit", display: "block" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, padding: "3px 6px", background: "var(--cream2)", borderRadius: 5, marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {a.entity?.ticker || a.entity?.canonical_name || "?"}{short(a.owner) ? <span style={{ color: "var(--muted)" }}> · {short(a.owner)}</span> : null}
                  </div>
                </Link>
              ))}
              {rows.length > 6 && <div style={{ fontSize: 10.5, color: "var(--muted)" }}>+{rows.length - 6} more</div>}
            </div>
          );
        })}
      </div>

      {stalled.length > 0 && (
        <>
          <div className="secttl">Stalled · no touch in 21+ days</div>
          {stalled.map((a) => (
            <Link key={a.id} href={`/territory/account/${a.id}`} style={{ color: "inherit", display: "block" }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.entity?.canonical_name || "Account"}</div>
                  <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{(a.crm_stage || "prospect").replace("_", " ")}{short(a.owner) ? ` · ${short(a.owner)}` : " · unassigned"}</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 800, color: a.days >= 45 ? "var(--red)" : "#9A6700", flexShrink: 0 }}>
                  {a.days}d quiet
                </span>
              </div>
            </Link>
          ))}
        </>
      )}

      {neverTouched > 0 && (
        <p style={{ fontSize: 12, color: "var(--ink2)", margin: "8px 0 0" }}>
          {neverTouched} open account{neverTouched === 1 ? " has" : "s have"} no activity logged yet.
        </p>
      )}

      <div className="secttl">Activity · last 7 days</div>
      <div className="card" style={{ padding: "10px 12px", marginBottom: 4 }}>
        {members.map((m) => {
          const s = actBy[m.id] ?? { touch: 0, tasksDone: 0 };
          return (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", borderBottom: "1px solid #F0EAE0" }}>
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600 }}>{m.email.split("@")[0]}</span>
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>{s.touch} touchpoints logged</span>
              <span style={{ fontSize: 12, color: s.tasksDone ? "var(--green)" : "var(--muted)", fontWeight: 700 }}>{s.tasksDone} tasks done</span>
            </div>
          );
        })}
        <div style={{ fontSize: 10.5, color: "var(--muted)", marginTop: 6 }}>Touchpoints = notes, calls, meetings, emails logged on accounts.</div>
      </div>

      <div className="secttl">Reps by acumen</div>
      {members.map((m) => {
        const a = acumenOf(m.id);
        const tr = tier(a);
        return (
          <div key={m.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.email}</div>
              <div style={{ fontSize: 12, color: "var(--ink2)" }}>{m.role} · {masteredBy[m.id] || 0} mastered</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{a}</div>
              <span style={{ background: tr.color, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 7px" }}>{tr.name}</span>
            </div>
          </div>
        );
      })}

      <div className="secttl">Concept acumen (verified — from Challenges)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--ink2)" }}>Concept</th>
              {members.map((m) => (
                <th key={m.id} style={{ padding: "6px 6px", color: "var(--ink2)", fontWeight: 700, fontSize: 11 }} title={m.email}>
                  {m.email.split("@")[0].slice(0, 8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONCEPTS.map(([key, label]) => (
              <tr key={key}>
                <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</td>
                {members.map((m) => {
                  const cs = conceptScores(evBy[m.id] || []).find((c) => c.key === key);
                  const s = cs?.score ?? null;
                  return <td key={m.id} style={{ background: heatColor(s), textAlign: "center", padding: "6px 8px", fontWeight: 700, borderRadius: 4 }}>{s == null ? "—" : s}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
        Acumen is verified-weighted: Challenge answers drive it, flashcard mastery adds a small capped bonus. Green ≥75 · yellow ≥50 · red below · grey = no attempts.
      </p>

      <style>{`.secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 8px}`}</style>
    </Shell>
  );
}
