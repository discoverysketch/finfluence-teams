import { createAdminClient } from "@/lib/supabase/admin";
import { pushToUsers } from "@/lib/push";
import { NextResponse } from "next/server";

// Earnings Pulse watcher (Vercel cron, every 6h). For every entity held as an
// account anywhere, check EDGAR for a 10-K/10-Q filed in the last 48h; log it
// (accession unique = notify once) and push to the reps holding that account.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = { "User-Agent": "FinFluency dan.wain1@gmail.com" };
const WINDOW_MS = 48 * 60 * 60 * 1000;

export async function GET(request: Request) {
  // Vercel sends Authorization: Bearer <CRON_SECRET> to cron routes.
  const auth = request.headers.get("authorization") || "";
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  // Entities held as accounts (with a CIK), plus who holds them.
  const { data: accts } = await admin.from("accounts")
    .select("list_id, entity:entities(id, cik, canonical_name, ticker)")
    .not("entity_id", "is", null);
  const holders: Record<string, Set<string>> = {}; // entity_id -> list_ids
  const entities: Record<string, any> = {};
  for (const a of (accts ?? []) as any[]) {
    if (!a.entity?.cik) continue;
    entities[a.entity.id] = a.entity;
    (holders[a.entity.id] ??= new Set()).add(a.list_id);
  }
  const ids = Object.keys(entities).slice(0, 60); // bound EDGAR calls per run
  if (!ids.length) return NextResponse.json({ checked: 0, filings: 0, pushed: 0 });

  // list -> tenant -> users (whole tenant gets the pulse; assignments can narrow later)
  const listIds = [...new Set(Object.values(holders).flatMap((s) => [...s]))];
  const { data: lists } = await admin.from("account_lists").select("id, tenant_id").in("id", listIds);
  const tenantOfList: Record<string, string> = {};
  for (const l of (lists ?? []) as any[]) tenantOfList[l.id] = l.tenant_id;
  const tenantIds = [...new Set(Object.values(tenantOfList))];
  const { data: users } = await admin.from("users").select("id, tenant_id").in("tenant_id", tenantIds);
  const usersOfTenant: Record<string, string[]> = {};
  for (const u of (users ?? []) as any[]) (usersOfTenant[u.tenant_id] ??= []).push(u.id);

  const now = Date.now();
  let filings = 0, pushed = 0, checked = 0;
  for (const eid of ids) {
    const ent = entities[eid];
    checked++;
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${String(ent.cik).padStart(10, "0")}.json`, { headers: UA });
      if (!r.ok) continue;
      const j: any = await r.json();
      const rec = j?.filings?.recent;
      if (!rec?.form) continue;
      for (let i = 0; i < rec.form.length && i < 30; i++) {
        const form = rec.form[i];
        if (form !== "10-K" && form !== "10-Q") continue;
        const filed = rec.filingDate[i];
        if (now - +new Date(filed) > WINDOW_MS) continue;
        const accession = rec.accessionNumber[i];
        const { error } = await admin.from("filing_events").insert({ entity_id: eid, form, filed, accession });
        if (error) continue; // duplicate accession -> already notified
        filings++;
        const userIds = [...new Set([...(holders[eid] ?? [])].map((l) => tenantOfList[l]).flatMap((t) => usersOfTenant[t] ?? []))];
        pushed += await pushToUsers(userIds, {
          title: `${ent.canonical_name} just filed a ${form} 📊`,
          body: "Fresh numbers are in — take the 5-question Earnings Pulse.",
          url: `/challenge/pulse?entity=${eid}`,
          tag: `filing-${accession}`,
        });
      }
    } catch { /* skip this entity, keep going */ }
  }
  return NextResponse.json({ checked, filings, pushed });
}
