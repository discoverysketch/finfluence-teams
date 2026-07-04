import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Finn from "@/components/Finn";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users").select("email, role, tenant_id").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "admin" || profile?.role === "manager";

  // mastered count for a little motivation
  const { count: masteredCount } = await supabase
    .from("progress").select("*", { count: "exact", head: true }).eq("status", "mastered");

  return (
    <Shell active="home" isAdmin={isAdmin}>
      <div style={{ textAlign: "center", marginTop: 8 }}>
        <Finn className="bob" style={{ width: 96, height: 114 }} />
        <h1 style={{ marginTop: 0 }}>Fin<span style={{ color: "var(--red)" }}>Fluency</span></h1>
      </div>

      <div className="card">
        <p style={{ margin: 0 }}>Signed in as <b>{user.email}</b></p>
        {profile ? (
          <p style={{ color: "var(--ink2)", margin: "6px 0 0" }}>
            Role: <b>{profile.role}</b> · {masteredCount ?? 0} cards mastered
          </p>
        ) : (
          <p style={{ color: "var(--red)", margin: "6px 0 0" }}>
            No tenant profile yet — an admin needs to add you to a tenant.
          </p>
        )}
      </div>

      <p style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/learn" className="btn">Learning path →</Link>
        <Link href="/challenge" className="btn" style={{ background: "var(--teal)" }}>Company Challenge →</Link>
        <Link href="/territory" className="btn" style={{ background: "var(--gold)", color: "var(--ink)" }}>🏢 My accounts</Link>
        {isManager && (
          <Link href="/manager" className="btn" style={{ background: "var(--blue)" }}>📊 Team dashboard</Link>
        )}
        {isAdmin && (
          <>
            <Link href="/admin/content" className="btn" style={{ background: "var(--charcoal)" }}>✏️ Content editor</Link>
            <Link href="/admin/team" className="btn" style={{ background: "var(--purple)" }}>👥 Team roster</Link>
          </>
        )}
      </p>

      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button className="btn" style={{ background: "none", color: "var(--ink2)", border: "1px solid var(--border)", fontSize: 13, padding: "9px 16px" }}>
          Sign out
        </button>
      </form>
    </Shell>
  );
}
