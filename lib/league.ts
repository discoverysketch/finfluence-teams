import type { SupabaseClient } from "@supabase/supabase-js";

// League scoring (SPEC 6e): points = correct answers (10, hard 15) × streak
// multiplier (active days, capped 1.5×). Week is Monday-based UTC; season is the
// calendar quarter. Aggregates via the service role AFTER the caller's tenant is
// verified — raw score_events never reach the client.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type LeagueRow = { id: string; email: string; week: number; season: number; days: number };

export function periods(now = new Date()) {
  const qStart = new Date(Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1));
  const dow = (now.getUTCDay() + 6) % 7;
  const wStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - dow));
  const quarterLabel = `Q${Math.floor(now.getUTCMonth() / 3) + 1} ${now.getUTCFullYear()}`;
  return { qStart, wStart, quarterLabel };
}

export async function leagueStandings(admin: SupabaseClient, tenantId: string): Promise<LeagueRow[]> {
  const { qStart, wStart } = periods();
  const { data: members } = await admin.from("users").select("id,email").eq("tenant_id", tenantId);
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
  return (members ?? []).map((m: any) => {
    const a = agg[m.id];
    return {
      id: m.id, email: m.email,
      week: a ? Math.round(a.wBase * mult(a.wDays.size)) : 0,
      season: a ? Math.round(a.sBase * mult(a.sDays.size)) : 0,
      days: a ? a.wDays.size : 0,
    };
  }).sort((a, b) => b.week - a.week || b.season - a.season || a.email.localeCompare(b.email));
}
