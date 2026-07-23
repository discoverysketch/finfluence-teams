import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import CaseBuilder from "./CaseBuilder";

// Business-case builder: savings levers on THIS account's real figures,
// deterministic math, AI-written narrative, printable.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function CasePage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  const { data: acct } = await supabase.from("accounts")
    .select("id, deal_value, entity:entities(id, canonical_name, ticker)")
    .eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) {
    return (
      <Shell active="accounts" isAdmin={me?.role === "admin"}>
        <div className="card">Account not found. <Link href="/territory">← Back</Link></div>
      </Shell>
    );
  }

  return (
    <Shell active="accounts" isAdmin={me?.role === "admin"}>
      <p style={{ fontSize: 13 }} className="noprint"><Link href={`/territory/account/${accountId}`}>← {ent.canonical_name}</Link></p>
      <h1 style={{ marginTop: 0 }}>Business <span style={{ color: "var(--red)" }}>case</span> · {ent.canonical_name}</h1>
      <CaseBuilder entityId={ent.id} company={ent.canonical_name} dealValueUsd={(acct as any).deal_value ?? null} />
      <style>{`@media print { .noprint, nav, header { display: none !important } }`}</style>
    </Shell>
  );
}
