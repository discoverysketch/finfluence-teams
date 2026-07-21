import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import MapView, { type MapItem } from "./MapView";

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
    .select("id, crm_stage, entity:entities(id, canonical_name, ticker, data_tier, hq_state)")
    .eq("list_id", list?.id ?? "00000000-0000-0000-0000-000000000000");

  const items: MapItem[] = ((accts ?? []) as any[]).filter((a) => a.entity).map((a) => ({
    accountId: a.id, name: a.entity.canonical_name, ticker: a.entity.ticker,
    tier: a.entity.data_tier, stage: a.crm_stage, state: a.entity.hq_state || null,
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
