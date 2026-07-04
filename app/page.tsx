import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

// Authed home. Middleware already guarantees a session here; we load the profile
// (tenant + role) to confirm provisioning and branch by role later.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users")
    .select("email, role, tenant_id")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <main className="container">
      <h1>
        Fin<span style={{ color: "var(--red)" }}>Fluency</span> Teams
      </h1>
      <div className="card" style={{ marginTop: 16 }}>
        <p style={{ margin: 0 }}>
          Signed in as <b>{user.email}</b>
        </p>
        {profile ? (
          <p style={{ color: "var(--ink2)" }}>
            Role: <b>{profile.role}</b> · Tenant: <code>{profile.tenant_id ?? "—"}</code>
          </p>
        ) : (
          <p style={{ color: "var(--red)" }}>
            No tenant profile yet — an admin needs to add you to a tenant (roster, Phase 2).
          </p>
        )}
      </div>
      <p style={{ marginTop: 20, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Link href="/learn" className="btn" style={{ display: "inline-block", textDecoration: "none" }}>
          Go to the learning path →
        </Link>
        {profile?.role === "admin" && (
          <Link href="/admin/content" className="btn" style={{ display: "inline-block", textDecoration: "none", background: "var(--charcoal)" }}>
            ✏️ Content editor
          </Link>
        )}
      </p>
      <p style={{ color: "var(--ink2)", marginTop: 16, fontSize: 13 }}>
        Content is served from the database. Next: card-swipe UI + progress tracking. See <code>SPEC.md</code>.
      </p>
      <form action="/auth/signout" method="post" style={{ marginTop: 16 }}>
        <button className="btn" style={{ background: "var(--charcoal)" }}>
          Sign out
        </button>
      </form>
    </main>
  );
}
