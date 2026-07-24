import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Hub, { type Contact, type Activity } from "./Hub";
import DecisionAuthority from "./DecisionAuthority";

// Account Hub: CRM-lite home for one account — stage, org chart, activity.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  // RLS scopes this to the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, rep_notes, crm_stage, owner, deal_value, entity:entities(id, canonical_name, ticker, data_tier, hq_state, decision_locus, decision_note, decision_source, priorities_json, priorities_at)")
    .eq("id", accountId).maybeSingle();
  if (!acct) {
    return (
      <Shell active="accounts" isAdmin={isAdmin}>
        <h1>Account</h1>
        <div className="card">Account not found. <Link href="/territory">← Back to Accounts</Link></div>
      </Shell>
    );
  }

  const [{ data: contacts }, { data: activities }, { data: members }] = await Promise.all([
    supabase.from("contacts").select("*").eq("account_id", accountId).order("created_at"),
    supabase.from("activities").select("*").eq("account_id", accountId).order("created_at", { ascending: false }).limit(100),
    supabase.from("users").select("id, email"),
  ]);
  const emailOf: Record<string, string> = {};
  for (const m of (members ?? []) as any[]) emailOf[m.id] = m.email;

  const ent: any = acct.entity;
  const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <h1 style={{ margin: 0 }}>{ent?.canonical_name || "Account"}</h1>
        {ent?.ticker && <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--muted)", fontWeight: 700 }}>{ent.ticker}</span>}
        {ent?.data_tier && <span style={{ background: TIER_COLOR[ent.data_tier] || "#8A7E6E", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 8px" }}>Tier {ent.data_tier}</span>}
      </div>
      {ent?.id && <DecisionAuthority entityId={ent.id} initial={{ locus: ent.decision_locus ?? null, note: ent.decision_note ?? null, source: ent.decision_source ?? null }} />}
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 4px" }}>
        {ent?.id && <Link href={`/territory/plan/${ent.id}`} className="mini-link">📄 Account plan</Link>}
        {ent?.id && <Link href={`/territory/account/${acct.id}/meeting`} className="mini-link">🎧 Meeting mode</Link>}
        {ent?.id && <Link href={`/territory/account/${acct.id}/case`} className="mini-link">🧮 Business case</Link>}
        {ent?.id && <Link href={`/territory/cfo`} className="mini-link">💼 CFO Simulator</Link>}
        {ent?.id && <Link href={`/territory/duel`} className="mini-link">⚔️ Peer Duel</Link>}
      </p>
      <Hub
        accountId={acct.id}
        userId={user.id}
        entityId={ent?.id ?? null}
        ticker={ent?.ticker ?? null}
        initialStage={acct.crm_stage}
        initialNotes={acct.rep_notes}
        initialOwner={(acct as any).owner ?? null}
        initialDealValue={(acct as any).deal_value ?? null}
        initialPriorities={ent?.priorities_json ?? null}
        prioritiesAt={ent?.priorities_at ?? null}
        initialContacts={(contacts ?? []) as Contact[]}
        initialActivities={(activities ?? []) as Activity[]}
        emailOf={emailOf}
      />
      <style>{`.mini-link{border:1px solid var(--border);background:#fff;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;color:var(--ink2);text-decoration:none}`}</style>
    </Shell>
  );
}
