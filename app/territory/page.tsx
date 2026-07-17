import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Territory, { type Account } from "./Territory";
import { Swords, Briefcase, LayoutDashboard, Telescope } from "lucide-react";

export default async function TerritoryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  if (!me?.tenant_id) {
    return <Shell active="accounts"><h1>My accounts</h1><div className="card">No tenant yet — an admin needs to add you.</div></Shell>;
  }
  const isAdmin = me.role === "admin";

  // Ensure the tenant has a default account list.
  let { data: list } = await supabase.from("account_lists")
    .select("id,name").eq("tenant_id", me.tenant_id).order("created_at").limit(1).maybeSingle();
  if (!list) {
    const { data: created } = await supabase.from("account_lists")
      .insert({ tenant_id: me.tenant_id, name: "My accounts" }).select("id,name").single();
    list = created ?? null;
  }

  const { data: accts } = await supabase.from("accounts")
    .select("id, rep_notes, crm_stage, entity:entities(id,canonical_name,ticker,data_tier,entity_type,hq_state)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <h1>My <span style={{ color: "var(--red)" }}>accounts</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Paste your account names — I&apos;ll match each to the SEC filer directory. Confirmed accounts feed learning, peer duels &amp; territory planning.
      </p>
      {(accts?.length ?? 0) > 0 && (
        <p style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
          <Link href="/territory/duel" className="btn btn-i" style={{ background: "var(--red)", padding: "9px 14px", fontSize: 13 }}><Swords size={15} strokeWidth={2.2} /> Peer Duel</Link>
          <Link href="/territory/cfo" className="btn btn-i" style={{ background: "var(--charcoal)", padding: "9px 14px", fontSize: 13 }}><Briefcase size={15} strokeWidth={2.2} /> CFO Simulator</Link>
          <Link href="/territory/board" className="btn btn-i" style={{ background: "var(--blue)", padding: "9px 14px", fontSize: 13 }}><LayoutDashboard size={15} strokeWidth={2.2} /> Territory Board</Link>
          <Link href="/territory/whitespace" className="btn btn-i" style={{ background: "var(--purple)", padding: "9px 14px", fontSize: 13 }}><Telescope size={15} strokeWidth={2.2} /> Whitespace</Link>
        </p>
      )}
      <Territory listId={list?.id ?? ""} initial={(accts ?? []) as unknown as Account[]} />
    </Shell>
  );
}
