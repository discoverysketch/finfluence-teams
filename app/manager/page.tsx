import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import { CONCEPTS, conceptScores, overallAcumen, tier, heatColor, type Ev } from "@/lib/acumen";

type Member = { id: string; email: string; role: string };

export default async function ManagerPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin" && me?.role !== "manager") {
    return <Shell active="home" isAdmin={false}><h1>Team dashboard</h1><div className="card">Managers and admins only.</div></Shell>;
  }

  const [{ data: memberData }, { data: progData }, { data: evData }] = await Promise.all([
    supabase.from("users").select("id,email,role").eq("tenant_id", me.tenant_id).order("email"),
    supabase.from("progress").select("user_id").eq("status", "mastered"),
    supabase.from("score_events").select("user_id,concept_tag,correct"),
  ]);
  const members = (memberData ?? []) as Member[];
  const mastered = (progData ?? []) as { user_id: string }[];
  const events = (evData ?? []) as (Ev & { user_id: string })[];

  const masteredBy: Record<string, number> = {};
  mastered.forEach((p) => { masteredBy[p.user_id] = (masteredBy[p.user_id] || 0) + 1; });
  const evBy: Record<string, Ev[]> = {};
  events.forEach((e) => { (evBy[e.user_id] = evBy[e.user_id] || []).push(e); });

  const acumenOf = (uid: string) => overallAcumen(evBy[uid] || [], masteredBy[uid] || 0);
  const teamAcumen = members.length ? Math.round(members.reduce((n, m) => n + acumenOf(m.id), 0) / members.length) : 0;
  const totalMastered = mastered.length;

  const Stat = ({ n, l }: { n: string; l: string }) => (
    <div className="card" style={{ flex: 1, textAlign: "center", padding: 12 }}>
      <div style={{ fontSize: 24, fontWeight: 800, color: "var(--red)" }}>{n}</div>
      <div style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600 }}>{l}</div>
    </div>
  );

  return (
    <Shell active="home" isAdmin={me.role === "admin"}>
      <h1>Team <span style={{ color: "var(--red)" }}>dashboard</span></h1>

      <div style={{ display: "flex", gap: 8 }}>
        <Stat n={String(members.length)} l="members" />
        <Stat n={String(teamAcumen)} l="team acumen" />
        <Stat n={String(totalMastered)} l="cards mastered" />
      </div>

      <div className="secttl">Reps by acumen</div>
      {members.map((m) => {
        const a = acumenOf(m.id);
        const tr = tier(a);
        return (
          <div key={m.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.email}</div>
              <div style={{ fontSize: 12, color: "var(--ink2)" }}>{m.role} · {masteredBy[m.id] || 0} mastered</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{a}</div>
              <span style={{ background: tr.color, color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 5, padding: "2px 7px" }}>{tr.name}</span>
            </div>
          </div>
        );
      })}

      <div className="secttl">Concept acumen (verified — from Challenges)</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", fontSize: 12, minWidth: "100%" }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "6px 8px", color: "var(--ink2)" }}>Concept</th>
              {members.map((m) => (
                <th key={m.id} style={{ padding: "6px 6px", color: "var(--ink2)", fontWeight: 700, fontSize: 11 }} title={m.email}>
                  {m.email.split("@")[0].slice(0, 8)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CONCEPTS.map(([key, label]) => (
              <tr key={key}>
                <td style={{ padding: "6px 8px", fontWeight: 600, whiteSpace: "nowrap" }}>{label}</td>
                {members.map((m) => {
                  const cs = conceptScores(evBy[m.id] || []).find((c) => c.key === key);
                  const s = cs?.score ?? null;
                  return <td key={m.id} style={{ background: heatColor(s), textAlign: "center", padding: "6px 8px", fontWeight: 700, borderRadius: 4 }}>{s == null ? "—" : s}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
        Acumen is verified-weighted: Challenge answers drive it, flashcard mastery adds a small capped bonus. Green ≥75 · yellow ≥50 · red below · grey = no attempts.
      </p>

      <style>{`.secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 8px}`}</style>
    </Shell>
  );
}
