import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Finn from "@/components/Finn";
import NotificationsCard from "@/components/NotificationsCard";
import MyTasks, { type Task } from "@/components/MyTasks";
import { leagueStandings } from "@/lib/league";
import { conceptScores, CONCEPTS, type Ev } from "@/lib/acumen";

// My Day: the rep's morning screen — next steps, fresh filings, league standing,
// and the concept most worth sharpening. Everything links into the deeper tools.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("users").select("email, role, tenant_id").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const isManager = profile?.role === "admin" || profile?.role === "manager";

  if (!profile?.tenant_id) {
    return (
      <Shell active="home" isAdmin={false}>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <Finn className="bob" style={{ width: 96, height: 114 }} />
          <h1 style={{ marginTop: 0 }}>Fin<span style={{ color: "var(--red)" }}>Fluency</span></h1>
        </div>
        <div className="card"><p style={{ margin: 0 }}>Signed in as <b>{user.email}</b></p>
          <p style={{ color: "var(--red)", margin: "6px 0 0" }}>No tenant profile yet — an admin needs to add you to a tenant.</p></div>
      </Shell>
    );
  }

  // --- gather the day (parallel) ---
  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const [{ data: openTasks }, { data: acctRows }, { data: myEvents }, { data: prog }, standings] = await Promise.all([
    supabase.from("activities").select("id, body, due_at, account_id").eq("kind", "task").eq("done", false).order("due_at", { ascending: true, nullsFirst: false }).limit(8),
    supabase.from("accounts").select("id, entity:entities(id, canonical_name, ticker)"),
    supabase.from("score_events").select("concept_tag, correct").eq("user_id", user.id),
    supabase.from("progress").select("card_id").eq("status", "mastered").eq("user_id", user.id),
    leagueStandings(createAdminClient(), profile.tenant_id),
  ]);

  const acctName: Record<string, string> = {}; const acctEntity: Record<string, string> = {};
  for (const a of (acctRows ?? []) as any[]) { acctName[a.id] = a.entity?.canonical_name ?? "Account"; if (a.entity?.id) acctEntity[a.id] = a.entity.id; }
  const tasks: Task[] = ((openTasks ?? []) as any[])
    .filter((t) => acctName[t.account_id])
    .map((t) => ({ id: t.id, body: t.body, due_at: t.due_at, accountId: t.account_id, accountName: acctName[t.account_id] }));

  // fresh filings among my accounts (last 14 days)
  const entityIds = Object.values(acctEntity);
  const { data: filings } = entityIds.length
    ? await supabase.from("filing_events").select("id, form, filed, entity:entities(id, canonical_name, ticker)")
        .in("entity_id", entityIds).gte("filed", twoWeeksAgo).order("filed", { ascending: false }).limit(4)
    : { data: [] };

  // league position
  const rank = standings.findIndex((r) => r.id === user.id);
  const mine = rank >= 0 ? standings[rank] : null;

  // weakest verified concept -> a unit to sharpen it
  const scores = conceptScores((myEvents ?? []) as Ev[]).filter((c) => c.score != null).sort((a, b) => a.score! - b.score!);
  const weakest = scores[0] ?? null;
  let focusUnit: { id: string; title: string } | null = null;
  if (weakest) {
    const masteredIds = new Set(((prog ?? []) as any[]).map((p) => p.card_id));
    const { data: cards } = await supabase.from("cards").select("id, unit_id, units(title)").eq("concept_tag", weakest.key).limit(20);
    const target = ((cards ?? []) as any[]).find((c) => !masteredIds.has(c.id)) ?? (cards ?? [])[0];
    if (target) focusUnit = { id: target.unit_id, title: (target as any).units?.title ?? "the path" };
  }
  const label = Object.fromEntries(CONCEPTS);

  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <Shell active="home" isAdmin={isAdmin}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 4 }}>
        <Finn className="bob" style={{ width: 56, height: 66 }} />
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>{greet}<span style={{ color: "var(--red)" }}>.</span></h1>
          <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>{user.email} · {profile.role}</div>
        </div>
      </div>

      <MyTasks initial={tasks} />

      {(filings ?? []).length > 0 && (
        <>
          <div className="daysec">📊 Fresh filings</div>
          {(filings ?? []).map((f: any) => (
            <Link key={f.id} href={`/challenge/pulse?entity=${f.entity.id}`} style={{ color: "inherit" }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "10px 12px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{f.entity.canonical_name}</div>
                  <div style={{ fontSize: 12, color: "var(--ink2)" }}>{f.form} · {f.filed} · take the pulse</div>
                </div>
                <div style={{ fontSize: 18 }}>›</div>
              </div>
            </Link>
          ))}
        </>
      )}

      <div className="daysec">Today</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <Link href="/challenge/league" style={{ color: "inherit" }}>
          <div className="card" style={{ padding: "12px 14px", height: "100%" }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: "var(--red)" }}>{mine ? `#${rank + 1}` : "—"}</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>league · {mine?.week ?? 0} pts this week</div>
          </div>
        </Link>
        <Link href={focusUnit ? `/learn/${focusUnit.id}` : "/challenge"} style={{ color: "inherit" }}>
          <div className="card" style={{ padding: "12px 14px", height: "100%" }}>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{weakest ? `${label[weakest.key] ?? weakest.key} · ${weakest.score}` : "🎯 Get verified"}</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", fontWeight: 600 }}>
              {weakest ? (focusUnit ? `sharpen it in ${focusUnit.title}` : "your weakest concept") : "play a Challenge to build your Acumen"}
            </div>
          </div>
        </Link>
      </div>

      <div className="daysec">Go deeper</div>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: 0 }}>
        <Link href="/learn" className="btn" style={{ padding: "9px 14px", fontSize: 13 }}>🗺️ Path</Link>
        <Link href="/challenge" className="btn" style={{ background: "var(--teal)", padding: "9px 14px", fontSize: 13 }}>🎯 Challenge</Link>
        <Link href="/territory" className="btn" style={{ background: "var(--gold)", color: "var(--ink)", padding: "9px 14px", fontSize: 13 }}>🏢 Accounts</Link>
        {isManager && <Link href="/manager" className="btn" style={{ background: "var(--blue)", padding: "9px 14px", fontSize: 13 }}>📊 Team</Link>}
        {isAdmin && <Link href="/admin/content" className="btn" style={{ background: "var(--charcoal)", padding: "9px 14px", fontSize: 13 }}>✏️ Content</Link>}
        {isAdmin && <Link href="/admin/team" className="btn" style={{ background: "var(--purple)", padding: "9px 14px", fontSize: 13 }}>👥 Roster</Link>}
      </p>

      <NotificationsCard userId={user.id} />

      <form action="/auth/signout" method="post" style={{ marginTop: 24 }}>
        <button className="btn" style={{ background: "none", color: "var(--ink2)", border: "1px solid var(--border)", fontSize: 13, padding: "9px 16px" }}>
          Sign out
        </button>
      </form>
      <style>{`.daysec{font-size:11px;font-weight:700;color:#8A7E6E;text-transform:uppercase;letter-spacing:.6px;margin:20px 0 8px;text-align:left}`}</style>
    </Shell>
  );
}
