import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";

// League (SPEC 6e): weekly leaderboard scoped to the tenant. Score = challenge
// points (correct: 10, hard: 15) × streak multiplier (active days this week,
// capped 1.5×). Seasons follow calendar quarters. RLS only lets reps read their
// own score_events, so standings aggregate server-side via the service role
// after verifying the caller's tenant — no raw events reach the client.
/* eslint-disable @typescript-eslint/no-explicit-any */

type Row = { email: string; week: number; season: number; days: number };

export default async function LeaguePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role, tenants(display_mode)").eq("id", user.id).maybeSingle();
  if (!me?.tenant_id) {
    return <Shell active="challenge"><h1>League</h1><div className="card">No tenant yet — an admin needs to add you.</div></Shell>;
  }
  const t: any = (me as any).tenants;
  const mode = (Array.isArray(t) ? t[0]?.display_mode : t?.display_mode) || "playful";
  const isAdmin = me.role === "admin";

  const now = new Date();
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const dow = (now.getUTCDay() + 6) % 7; // Monday-based
  const wStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  const quarterLabel = `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;

  const admin = createAdminClient();
  const { data: members } = await admin.from("users").select("id,email").eq("tenant_id", me.tenant_id);
  const ids = (members ?? []).map((m: any) => m.id);
  const { data: ev } = ids.length
    ? await admin.from("score_events").select("user_id,correct,difficulty,created_at").in("user_id", ids).gte("created_at", qStart.toISOString())
    : { data: [] };

  const agg: Record<string, { wBase: number; sBase: number; wDays: Set<string>; sDays: Set<string> }> = {};
  for (const e of (ev ?? []) as any[]) {
    const a = (agg[e.user_id] ??= { wBase: 0, sBase: 0, wDays: new Set(), sDays: new Set() });
    const pts = e.correct ? (e.difficulty === "hard" ? 15 : 10) : 0;
    const day = String(e.created_at).slice(0, 10);
    a.sBase += pts; a.sDays.add(day);
    if (new Date(e.created_at) >= wStart) { a.wBase += pts; a.wDays.add(day); }
  }
  const mult = (days: number) => Math.min(1.5, 1 + 0.1 * Math.max(0, days - 1));
  const rows: Row[] = (members ?? []).map((m: any) => {
    const a = agg[m.id];
    return {
      email: m.email,
      week: a ? Math.round(a.wBase * mult(a.wDays.size)) : 0,
      season: a ? Math.round(a.sBase * mult(a.sDays.size)) : 0,
      days: a ? a.wDays.size : 0,
    };
  }).sort((a, b) => b.week - a.week || b.season - a.season || a.email.localeCompare(b.email));

  const playful = mode !== "professional";
  const medal = (i: number) => (playful ? ["🥇", "🥈", "🥉"][i] ?? `${i + 1}` : `${i + 1}`);

  return (
    <Shell active="challenge" isAdmin={isAdmin}>
      <p style={{ fontSize: 13 }}><Link href="/challenge">← Challenge</Link></p>
      <h1>{playful ? <>Weekly <span style={{ color: "var(--red)" }}>League</span></> : <>Acumen <span style={{ color: "var(--red)" }}>Rankings</span></>}</h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Points from Challenge, Peer Duel, CFO Simulator &amp; Metric Detective (correct answers ×10, hard ×15), boosted up to 1.5× by days active this week. Season resets each quarter — currently <b>{quarterLabel}</b>.
      </p>

      {rows.map((r, i) => (
        <div key={r.email} className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6, padding: "12px 14px", outline: r.email === user.email ? "2px solid var(--gold)" : "none" }}>
          <div style={{ fontSize: playful && i < 3 ? 22 : 15, fontWeight: 800, width: 34, textAlign: "center", color: "var(--ink2)" }}>{medal(i)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{r.email.split("@")[0]}{r.email === user.email && <span style={{ color: "var(--muted)", fontWeight: 500 }}> (you)</span>}</div>
            <div style={{ fontSize: 12, color: "var(--ink2)" }}>{r.days} day{r.days === 1 ? "" : "s"} active this week · season {r.season}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontWeight: 800, fontSize: 20, color: "var(--red)" }}>{r.week}</div>
            <div style={{ fontSize: 10, color: "var(--muted)" }}>this week</div>
          </div>
        </div>
      ))}
      {rows.every((r) => r.week === 0) && (
        <div className="card" style={{ background: "#FAF6EE", borderColor: "#E6CF94", color: "#7A5B12", fontSize: 13 }}>
          No points yet this week — play a <Link href="/challenge">Challenge</Link>, a <Link href="/territory/duel">Peer Duel</Link>, or <Link href="/challenge/detective">Metric Detective</Link> to get on the board.
        </div>
      )}
    </Shell>
  );
}
