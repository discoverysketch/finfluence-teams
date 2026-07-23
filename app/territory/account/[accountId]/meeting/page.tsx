import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import MeetingMode from "./MeetingMode";

// Meeting Wingman: phone-first live-meeting companion — glanceable numbers up
// top, a whisper coach below (dictate what the customer said, get a speakable
// grounded reply). The CFO-sim coach, unleashed on real meetings.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function MeetingPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  const { data: acct } = await supabase.from("accounts")
    .select("id, entity:entities(id, canonical_name, ticker)")
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
      <p style={{ fontSize: 13 }}><Link href={`/territory/account/${accountId}`}>← {ent.canonical_name}</Link></p>
      <h1 style={{ marginTop: 0 }}>🎧 Meeting <span style={{ color: "var(--red)" }}>mode</span></h1>
      <MeetingMode entityId={ent.id} company={ent.canonical_name} />
    </Shell>
  );
}
