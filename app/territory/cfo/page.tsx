import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Cfo, { type Acct } from "./Cfo";

export default async function CfoPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me?.tenant_id ?? "").order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, entity:entities(id,canonical_name,ticker,data_tier)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
  const accounts = ((accts ?? []) as unknown as Acct[]).filter((a) => a.entity);

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
      <h1>CFO <span style={{ color: "var(--red)" }}>Simulator</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Rehearse with the CFO of one of your accounts — grounded in their real financials. They&apos;ll probe you; wrap up any time for a score and coaching.
      </p>
      {accounts.length === 0 ? (
        <div className="card">Add some accounts first — <Link href="/territory">go to Accounts</Link>.</div>
      ) : (
        <Cfo userId={user.id} accounts={accounts} />
      )}
    </Shell>
  );
}
