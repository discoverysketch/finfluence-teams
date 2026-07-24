import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { inviteMember, updateRole, removeMember, setDisplayMode } from "./actions";

type Member = { id: string; email: string; role: string };

// Relative "last seen" from an ISO timestamp (last_sign_in_at lives in Supabase
// auth, readable only via the service role).
function lastSeen(iso: string | null): { label: string; stale: boolean } {
  if (!iso) return { label: "never signed in", stale: true };
  const d = Date.now() - new Date(iso).getTime();
  const day = 86400000;
  const mins = Math.floor(d / 60000), hrs = Math.floor(d / 3600000), days = Math.floor(d / day);
  const label = mins < 2 ? "just now" : mins < 60 ? `${mins} min ago` : hrs < 24 ? `${hrs} hr ago` : days === 1 ? "yesterday" : days < 30 ? `${days} days ago` : new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return { label, stale: d > 14 * day };
}

export default async function TeamPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();

  if (me?.role !== "admin") {
    return (
      <Shell active="home" isAdmin={false}>
        <h1>Team</h1>
        <div className="card">Admins only.</div>
      </Shell>
    );
  }

  const [{ data: memberData }, { data: tenant }] = await Promise.all([
    supabase.from("users").select("id,email,role").eq("tenant_id", me.tenant_id).order("email"),
    supabase.from("tenants").select("display_mode").eq("id", me.tenant_id).maybeSingle(),
  ]);
  const members = (memberData ?? []) as Member[];
  const mode = tenant?.display_mode ?? "playful";
  const roleOptions = ["rep", "manager", "admin"];

  // Last sign-in per member from the auth system (service role).
  const lastById: Record<string, string | null> = {};
  try {
    const admin = createAdminClient();
    const { data: auth } = await admin.auth.admin.listUsers({ perPage: 200 });
    for (const u of auth?.users ?? []) lastById[u.id] = (u as { last_sign_in_at?: string | null }).last_sign_in_at ?? null;
  } catch { /* fall back to no last-seen data */ }

  return (
    <Shell active="home" isAdmin>
      <h1>Team <span style={{ color: "var(--red)" }}>roster</span></h1>

      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--muted)", marginBottom: 8 }}>Display mode</div>
        <div style={{ display: "flex", gap: 8 }}>
          <form action={setDisplayMode}>
            <input type="hidden" name="mode" value="playful" />
            <button className="btn" style={{ padding: "8px 14px", fontSize: 13, background: mode === "playful" ? "var(--red)" : "#fff", color: mode === "playful" ? "#fff" : "var(--ink2)", border: "1px solid var(--border)" }}>🎮 Playful (XP &amp; levels)</button>
          </form>
          <form action={setDisplayMode}>
            <input type="hidden" name="mode" value="professional" />
            <button className="btn" style={{ padding: "8px 14px", fontSize: 13, background: mode === "professional" ? "var(--charcoal)" : "#fff", color: mode === "professional" ? "#fff" : "var(--ink2)", border: "1px solid var(--border)" }}>💼 Professional (Acumen)</button>
          </form>
        </div>
      </div>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        {members.length} member{members.length === 1 ? "" : "s"} · invites send a magic-link email; new people also just log in with their email.
      </p>

      {members.map((m) => {
        const seen = lastSeen(lastById[m.id] ?? null);
        return (
        <div key={m.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{m.email}{m.id === user.id && <span style={{ color: "var(--muted)", fontWeight: 400 }}> (you)</span>}</div>
            <div style={{ fontSize: 11.5, marginTop: 1, color: seen.stale ? "var(--red)" : "var(--ink2)", fontWeight: seen.stale ? 700 : 500 }}>
              {seen.stale && seen.label !== "never signed in" ? "⚠ " : ""}Last seen: {seen.label}
            </div>
          </div>
          <form action={updateRole} style={{ display: "flex", gap: 6, width: "auto" }}>
            <input type="hidden" name="id" value={m.id} />
            <select name="role" defaultValue={m.role} style={{ width: "auto", padding: "6px 8px", fontSize: 13 }}>
              {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <button className="btn" style={{ padding: "6px 12px", fontSize: 13 }}>Save</button>
          </form>
          {m.id !== user.id && (
            <form action={removeMember} style={{ width: "auto" }}>
              <input type="hidden" name="id" value={m.id} />
              <button className="btn" style={{ padding: "6px 12px", fontSize: 13, background: "#F9E7E3", color: "var(--red)" }}>Remove</button>
            </form>
          )}
        </div>
        );
      })}

      <form action={inviteMember} className="card" style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".6px", color: "var(--muted)", marginBottom: 8 }}>Add a member</div>
        <input name="email" type="email" placeholder="rep@company.com" required style={{ marginBottom: 8 }} />
        <div style={{ display: "flex", gap: 8 }}>
          <select name="role" defaultValue="rep" style={{ flex: 1 }}>
            <option value="rep">Rep</option>
            <option value="manager">Manager</option>
            <option value="admin">Admin</option>
          </select>
          <button className="btn">Invite</button>
        </div>
      </form>
    </Shell>
  );
}
