import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Hub, { type Contact, type Activity } from "./Hub";
import DecisionAuthority from "./DecisionAuthority";
import CompanyLogo from "@/components/CompanyLogo";
import { companyDomain } from "@/lib/logo";
import { inferArchetype, ARCHETYPE_LABEL } from "@/lib/archetype";

// Account Hub: CRM-lite home for one account — stage, org chart, activity.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function AccountPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";
  const isManagerAdmin = me?.role === "admin" || me?.role === "manager";

  // RLS scopes this to the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, rep_notes, owner, created_by, created_at, entity:entities(id, canonical_name, ticker, data_tier, hq_state, decision_locus, decision_note, decision_source, decision_at, priorities_json, priorities_at, risks_json, risks_at, dockets_json, dockets_at, business_json, business_at, sic, parent_name, entity_type, hiring_json, stack_json, profile_json, website)")
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

  // What kind of company this is decides where its research is aimed, so it is
  // shown next to the name — a rep should be able to see why an account is
  // being researched the way it is.
  const archetype = ent ? inferArchetype(ent) : "unknown";
  const archetypeLabel = ARCHETYPE_LABEL[archetype];

  // The stored website is authoritative; mining URLs left behind by research is
  // only a fallback for entities that have not been backfilled yet.
  const site: string | null = ent?.website ?? null;
  const logoDomain = site
    ? site.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
    : ent?.canonical_name
      ? companyDomain(ent.canonical_name, [ent.hiring_json, ent.stack_json, ent.profile_json, ent.priorities_json])
      : null;

  // Who put this account in the book. Distinct from `owner`, which is
  // reassignable — this is written once at insert and never changes.
  const creator = (acct as any).created_by as string | null;
  const addedBy = creator ? (emailOf[creator]?.split("@")[0] ?? "a teammate") : null;
  const addedOn = (acct as any).created_at
    ? new Date((acct as any).created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <CompanyLogo name={ent?.canonical_name || "Account"} domain={logoDomain} size={42} />
        <h1 style={{ margin: 0 }}>{ent?.canonical_name || "Account"}</h1>
        {ent?.ticker && <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--muted)", fontWeight: 700 }}>{ent.ticker}</span>}
        {ent?.data_tier && <span style={{ background: TIER_COLOR[ent.data_tier] || "#8A7E6E", color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "2px 8px" }}>Tier {ent.data_tier}</span>}
        <span title="Decides which sources research is aimed at" style={{ border: "1px solid var(--border)", color: "var(--ink2)", fontSize: 11, fontWeight: 700, borderRadius: 5, padding: "1px 8px" }}>{archetypeLabel}</span>
      </div>
      {logoDomain && (
        <div style={{ fontSize: 12.5, marginTop: 3 }}>
          <a href={`https://${logoDomain}`} target="_blank" rel="noreferrer" style={{ color: "var(--blue)", fontWeight: 700 }}>{logoDomain} ↗</a>
        </div>
      )}
      {addedBy && (
        <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
          Added by <b style={{ color: "var(--ink2)" }}>{addedBy}</b>{addedOn ? ` · ${addedOn}` : ""}
        </div>
      )}
      {ent?.id && <DecisionAuthority entityId={ent.id} initial={{ locus: ent.decision_locus ?? null, note: ent.decision_note ?? null, source: ent.decision_source ?? null, at: ent.decision_at ?? null }} />}
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 4px" }}>
        {ent?.id && <Link href={`/territory/plan/${ent.id}`} className="mini-link">📄 Account plan</Link>}
        {ent?.id && <Link href={`/territory/account/${acct.id}/meeting`} className="mini-link">🎧 Meeting mode</Link>}
        {ent?.id && <Link href={`/territory/account/${acct.id}/case`} className="mini-link">🧮 Business case</Link>}
        {ent?.id && <Link href={`/territory/cfo?entity=${ent.id}`} className="mini-link">💼 CFO Simulator</Link>}
        {ent?.id && <Link href={`/territory/duel?entity=${ent.id}`} className="mini-link">⚔️ Peer Duel</Link>}
        <Link href="/contracts" className="mini-link">📜 Negotiation desk</Link>
        <Link href="/partners" className="mini-link">🤝 Partner desk</Link>
      </p>
      <Hub
        accountId={acct.id}
        userId={user.id}
        entityId={ent?.id ?? null}
        ticker={ent?.ticker ?? null}
        initialNotes={acct.rep_notes}
        initialOwner={(acct as any).owner ?? null}
        canAssign={isManagerAdmin}
        canResearch={isManagerAdmin || (acct as any).owner === user.id}
        initialPriorities={ent?.priorities_json ?? null}
        prioritiesAt={ent?.priorities_at ?? null}
        initialRisks={ent?.risks_json ?? null}
        risksAt={ent?.risks_at ?? null}
        initialDockets={ent?.dockets_json ?? null}
        docketsAt={ent?.dockets_at ?? null}
        initialBusiness={ent?.business_json ?? null}
        businessAt={ent?.business_at ?? null}
        archetypeLabel={archetypeLabel}
        initialContacts={(contacts ?? []) as Contact[]}
        initialActivities={(activities ?? []) as Activity[]}
        emailOf={emailOf}
      />
      <style>{`.mini-link{border:1px solid var(--border);background:#fff;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;color:var(--ink2);text-decoration:none}`}</style>
    </Shell>
  );
}
