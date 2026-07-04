import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { inviteMember, updateRole, removeMember } from "./actions";

type Member = { id: string; email: string; role: string };

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

  const { data: memberData } = await supabase
    .from("users").select("id,email,role").eq("tenant_id", me.tenant_id).order("email");
  const members = (memberData ?? []) as Member[];

  const roleOptions = ["rep", "manager", "admin"];

  return (
    <Shell active="home" isAdmin>
      <h1>Team <span style={{ color: "var(--red)" }}>roster</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        {members.length} member{members.length === 1 ? "" : "s"} · invites send a magic-link email; new people also just log in with their email.
      </p>

      {members.map((m) => (
        <div key={m.id} className="card" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6, padding: "10px 12px", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 160, fontSize: 14, fontWeight: 600 }}>
            {m.email}{m.id === user.id && <span style={{ color: "var(--muted)", fontWeight: 400 }}> (you)</span>}
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
      ))}

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
