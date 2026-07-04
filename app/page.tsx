import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

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
      <p style={{ color: "var(--ink2)", marginTop: 24, fontSize: 13 }}>
        Phase 1 scaffold. Next: port the learning path + Company Challenge and back progress with
        the database. See <code>SPEC.md</code>.
      </p>
      <form action="/auth/signout" method="post" style={{ marginTop: 16 }}>
        <button className="btn" style={{ background: "var(--charcoal)" }}>
          Sign out
        </button>
      </form>
    </main>
  );
}
