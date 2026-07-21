import { leagueStandings } from "@/lib/league";
import { classifyFiling } from "@/lib/signalTypes";

// Monday digest email: each rep's week — their book's signals, league standing,
// open tasks — sent via Resend (same domain as auth emails). Rides the daily
// check-filings cron (Hobby plan caps cron jobs at 2). No-ops without
// RESEND_API_KEY so the cron never breaks on a missing key.
/* eslint-disable @typescript-eslint/no-explicit-any */

const SITE = process.env.NEXT_PUBLIC_SITE_URL || "https://accountfluency.com";
const FROM = process.env.DIGEST_FROM || "AccountFluency <finn@accountfluency.com>";

function esc(s: string) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

function renderHtml(o: { rank: number | null; weekPts: number; signals: { name: string; label: string; filed: string; icon: string }[]; tasks: { body: string; due: string | null }[] }) {
  const sigRows = o.signals.length
    ? o.signals.map((s) => `<div style="padding:8px 0;border-bottom:1px solid #F0EAE0;font-size:13.5px;"><b>${s.icon} ${esc(s.name)}</b> — ${esc(s.label)} <span style="color:#8A7E6E;">· ${esc(s.filed)}</span></div>`).join("")
    : `<div style="font-size:13px;color:#6B6254;">No filings from your accounts this week.</div>`;
  const taskRows = o.tasks.length
    ? o.tasks.map((t) => `<div style="padding:6px 0;font-size:13.5px;">☐ ${esc(t.body)}${t.due ? ` <span style="color:#8A7E6E;">· due ${esc(t.due)}</span>` : ""}</div>`).join("")
    : `<div style="font-size:13px;color:#6B6254;">Nothing open — log next steps on your accounts.</div>`;
  const sec = (t: string) => `<div style="font-size:11px;font-weight:700;color:#9A6700;text-transform:uppercase;letter-spacing:.7px;margin:18px 0 6px;">${t}</div>`;
  return `
<table width="100%" cellpadding="0" cellspacing="0" style="background:#FBF7EF;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #E0D8CB;border-radius:12px;">
      <tr><td style="padding:32px;font-family:Arial,Helvetica,sans-serif;">
        <div style="font-size:22px;font-weight:800;color:#2B2620;letter-spacing:-.02em;">AccountFluency</div>
        <div style="font-size:11px;font-weight:700;color:#9A6700;text-transform:uppercase;letter-spacing:.7px;margin:4px 0 16px;">Your week, in one look</div>
        ${o.rank != null ? `<div style="font-size:14px;color:#3A342B;">You're <b>#${o.rank}</b> in the league with <b>${o.weekPts}</b> points this week.</div>` : ""}
        ${sec("Signals from your accounts")}${sigRows}
        ${sec("Open next steps")}${taskRows}
        <a href="${SITE}" style="display:inline-block;background:#B23A2E;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;border-radius:10px;padding:12px 22px;margin-top:22px;">Open AccountFluency</a>
        <div style="font-size:11px;color:#8A7E6E;margin-top:22px;line-height:1.5;">Sent Mondays. Figures from SEC filings — verify before acting.</div>
      </td></tr>
    </table>
  </td></tr>
</table>`;
}

export async function sendWeeklyDigests(admin: any): Promise<{ sent: number; skipped?: string; errors: number }> {
  if (!process.env.RESEND_API_KEY) return { sent: 0, skipped: "RESEND_API_KEY not set", errors: 0 };

  const { data: auth } = await admin.auth.admin.listUsers();
  const emailOf: Record<string, string> = Object.fromEntries((auth?.users ?? []).map((u: any) => [u.id, u.email]));
  const { data: users } = await admin.from("users").select("id, tenant_id");
  const tenants = [...new Set(((users ?? []) as any[]).map((u) => u.tenant_id).filter(Boolean))];

  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  let sent = 0, errors = 0;

  for (const tenantId of tenants) {
    const { data: list } = await admin.from("account_lists").select("id").eq("tenant_id", tenantId).order("created_at").limit(1).maybeSingle();
    const { data: accts } = await admin.from("accounts").select("entity_id").eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
    const entityIds = ((accts ?? []) as any[]).map((a) => a.entity_id).filter(Boolean);
    const { data: events } = entityIds.length
      ? await admin.from("filing_events").select("form, filed, items, label, entity:entities(canonical_name)").in("entity_id", entityIds).gte("filed", weekAgo).order("filed", { ascending: false }).limit(5)
      : { data: [] };
    const signals = ((events ?? []) as any[]).map((ev) => {
      const s = classifyFiling(ev.form, ev.items);
      return { name: ev.entity?.canonical_name ?? "Account", label: ev.label || s?.label || `${ev.form} filed`, filed: ev.filed, icon: s?.icon ?? "📄" };
    });
    const standings = await leagueStandings(admin, tenantId);

    for (const u of ((users ?? []) as any[]).filter((x) => x.tenant_id === tenantId)) {
      const email = emailOf[u.id];
      if (!email) continue;
      const { data: tasks } = await admin.from("activities").select("body, due_at").eq("user_id", u.id).eq("kind", "task").eq("done", false).order("due_at", { ascending: true, nullsFirst: false }).limit(3);
      const rank = standings.findIndex((r: any) => r.id === u.id);
      const html = renderHtml({
        rank: rank >= 0 ? rank + 1 : null,
        weekPts: rank >= 0 ? (standings[rank] as any).week ?? 0 : 0,
        signals,
        tasks: ((tasks ?? []) as any[]).map((t) => ({ body: String(t.body).slice(0, 120), due: t.due_at ? String(t.due_at).slice(0, 10) : null })),
      });
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: FROM, to: email, subject: "Your week at AccountFluency", html }),
        });
        if (r.ok) sent++; else errors++;
      } catch { errors++; }
    }
  }
  return { sent, errors };
}
