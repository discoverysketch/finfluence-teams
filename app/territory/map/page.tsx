import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import MapView, { type MapItem } from "./MapView";

const US_STATES = new Set("AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" "));

// Self-healing HQ states: SEC directory entities arrive without one, so each
// map visit backfills a few from EDGAR (capped to keep the page snappy) —
// newly added public accounts converge onto the map within a visit or two.
async function backfillStates(rows: any[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const need = rows.filter((a) => a.entity?.cik && !a.entity.hq_state).slice(0, 8);
  if (!need.length) return;
  const admin = createAdminClient();
  await Promise.all(need.map(async (a) => {
    try {
      const r = await fetch(`https://data.sec.gov/submissions/CIK${String(a.entity.cik).padStart(10, "0")}.json`, {
        headers: { "User-Agent": "AccountFluency dan.wain1@gmail.com" },
      });
      if (!r.ok) return;
      const j: any = await r.json(); // eslint-disable-line @typescript-eslint/no-explicit-any
      const st = String(j.addresses?.business?.stateOrCountry || j.addresses?.mailing?.stateOrCountry || "").toUpperCase();
      if (US_STATES.has(st)) {
        await admin.from("entities").update({ hq_state: st }).eq("id", a.entity.id);
        a.entity.hq_state = st; // reflect immediately in this render
      }
    } catch { /* next visit retries */ }
  }));
}

// Territory map: the book plotted on a state tile grid — where the accounts
// are, colored by density, badged by tier. Tap a state to drill in.
/* eslint-disable @typescript-eslint/no-explicit-any */
export default async function MapPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).maybeSingle();
  if (!me?.tenant_id) return <Shell active="accounts"><div className="card">No tenant yet.</div></Shell>;

  const { data: list } = await supabase.from("account_lists")
    .select("id").eq("tenant_id", me.tenant_id).order("created_at").limit(1).maybeSingle();
  const { data: accts } = await supabase.from("accounts")
    .select("id, crm_stage, owner, entity:entities(id, canonical_name, ticker, cik, data_tier, hq_state)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");
  await backfillStates((accts ?? []) as any[]);

  const items: MapItem[] = ((accts ?? []) as any[]).filter((a) => a.entity).map((a) => ({
    accountId: a.id, name: a.entity.canonical_name, ticker: a.entity.ticker,
    tier: a.entity.data_tier, stage: a.crm_stage, state: a.entity.hq_state || null,
    mine: a.owner === user.id,
  }));

  return (
    <Shell active="accounts" isAdmin={me.role === "admin"}>
      <h1>Territory <span style={{ color: "var(--red)" }}>map</span></h1>
      <div className="seg" style={{ margin: "10px 0 12px" }}>
        <Link href="/territory">Book</Link>
        <Link href="/territory/board">Board</Link>
        <Link href="/territory/map" className="on">Map</Link>
        <Link href="/territory/whitespace">Whitespace</Link>
      </div>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Your book by headquarters state. Tap a state to see its accounts.
      </p>
      <MapView items={items} />
    </Shell>
  );
}
