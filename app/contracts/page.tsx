import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Contracts, { type Doc } from "./Contracts";

// Negotiation desk: what Oracle's own published standard terms say, and where a
// customer's usual asks actually land. Public documents only — nothing here is
// deal data, pricing or anything a rep could not already download from
// oracle.com/contracts.
export default async function ContractsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  const { data: docs } = await supabase.from("contract_docs")
    .select("doc_key, title, category, version_label, effective, source_url, chars").order("category");

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/territory">← Accounts</Link></p>
      <h1>Negotiation <span style={{ color: "var(--red)" }}>desk</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        What Oracle&apos;s published standard terms actually say — the agreement, the pillar document, the policies, the AI terms.
        Answers quote the clause and name the version, so you can check every one.
      </p>
      {!docs?.length ? (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13.5 }}>
          No contract documents are loaded yet. An admin needs to run <code>npm run load-contracts</code>.
        </div>
      ) : (
        <Contracts docs={docs as Doc[]} />
      )}
    </Shell>
  );
}
