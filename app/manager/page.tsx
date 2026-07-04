import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";

type Member = { id: string; email: string; role: string };
type Ev = { user_id: string; concept_tag: string | null; correct: boolean | null };

const CONCEPTS: [string, string][] = [
  ["prof", "Profitability"], ["liq", "Liquidity & Leverage"], ["ret", "Returns"],
  ["cash", "Cash & Capital"], ["found", "Foundations"],
];

function heat(acc: number | null) {
  if (acc == null) return { bg: "#EEE9DF", label: "—" };
  if (acc >= 0.8) return { bg: "#CDE9D8", label: Math.round(acc * 100) + "%" };
  if (acc >= 0.5) return { bg: "#F6E6B8", label: Math.round(acc * 100) + "%" };
  return { bg: "#F3CFC7", label: Math.round(acc * 100) + "%" };
}

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
  const events = (evData ?? []) as Ev[];

  // per-user rollups
  const masteredBy: Record<string, number> = {};
  mastered.forEach((p) => { masteredBy[p.user_id] = (masteredBy[p.user_id] || 0) + 1; });

  const accBy: Record<string, { c: number; t: number }> = {};
  const conceptBy: Record<string, Record<string, { c: number; t: number }>> = {};
  events.forEach((e) => {
    accBy[e.user_id] = accBy[e.user_id] || { c: 0, t: 0 };
    accBy[e.user_id].t++; if (e.correct) accBy[e.user_id].c++;
    if (e.concept_tag) {
      conceptBy[e.user_id] = conceptBy[e.user_id] || {};
      const cc = (conceptBy[e.user_id][e.concept_tag] = conceptBy[e.user_id][e.concept_tag] || { c: 0, t: 0 });
      cc.t++; if (e.correct) cc.c++;
    }
  });
  const acc = (u: string) => (accBy[u]?.t ? accBy[u].c / accBy[u].t : null);

  const totalMastered = mastered.length;
  const teamAcc = events.length ? events.filter((e) => e.correct).length / events.length : null;

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
        <Stat n={String(totalMastered)} l="cards mastered" />
        <Stat n={teamAcc == null ? "—" : Math.round(teamAcc * 100) + "%"} l="challenge accuracy" />
      </div>

      <div className="secttl">Reps</div>
      {members.map((m) => {
        const a = acc(m.id);
        return (
          <div key={m.id} className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{m.email}</div>
              <div style={{ fontSize: 12, color: "var(--ink2)" }}>{m.role} · {masteredBy[m.id] || 0} mastered</div>
            </div>
            <div style={{ fontWeight: 800, color: a == null ? "var(--muted)" : "var(--charcoal)" }}>
              {a == null ? "—" : Math.round(a * 100) + "%"}
            </div>
          </div>
        );
      })}

      <div className="secttl">Concept heatmap (challenge accuracy)</div>
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
                  const cc = conceptBy[m.id]?.[key];
                  const a = cc?.t ? cc.c / cc.t : null;
                  const h = heat(a);
                  return <td key={m.id} style={{ background: h.bg, textAlign: "center", padding: "6px 8px", fontWeight: 700, borderRadius: 4 }}>{h.label}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 10 }}>
        Green ≥80% · yellow ≥50% · red below · grey = no attempts yet. Data grows as reps take Company Challenges.
      </p>

      <style>{`.secttl{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 8px}`}</style>
    </Shell>
  );
}
