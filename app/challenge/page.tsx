import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Challenge from "./Challenge";

export default async function ChallengePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  return (
    <Shell active="challenge" isAdmin={profile?.role === "admin"}>
      <h1>Company <span style={{ color: "var(--red)" }}>Challenge</span></h1>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "10px 0 14px" }}>
        <Link href="/challenge/detective" className="btn" style={{ background: "var(--charcoal)", padding: "9px 14px", fontSize: 13 }}>🕵️ Metric Detective</Link>
        <Link href="/challenge/league" className="btn" style={{ background: "var(--gold)", color: "var(--ink)", padding: "9px 14px", fontSize: 13 }}>🏆 League</Link>
      </p>
      <Challenge userId={user.id} />
    </Shell>
  );
}
