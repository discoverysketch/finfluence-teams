import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Save a reviewed Tier D profile as a private entity (created_by_tenant = tenant,
// data_tier D) and link it to the tenant's account list. RLS-scoped (the entities
// write policy requires created_by_tenant = current_tenant_id()).
/* eslint-disable @typescript-eslint/no-explicit-any */
const TYPES = ["iou", "ipp", "coop", "muni", "retailer", "other"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("tenant_id").eq("id", user.id).maybeSingle();
  if (!me?.tenant_id) return NextResponse.json({ error: "No tenant" }, { status: 400 });

  const { profile, listId } = await request.json().catch(() => ({}));
  const name = String(profile?.canonical_name || "").trim();
  if (!name || !listId) return NextResponse.json({ error: "Missing profile or account list" }, { status: 400 });

  // Confirm the list belongs to the caller's tenant.
  const { data: list } = await supabase.from("account_lists").select("id").eq("id", listId).eq("tenant_id", me.tenant_id).maybeSingle();
  if (!list) return NextResponse.json({ error: "Account list not found" }, { status: 404 });

  const entity_type = TYPES.includes(profile?.entity_type) ? profile.entity_type : "other";
  const { data: ent, error: ee } = await supabase.from("entities").insert({
    canonical_name: name, entity_type, hq_state: profile?.hq_state || null,
    data_tier: "D", created_by_tenant: me.tenant_id, profile_json: profile,
  }).select("id").single();
  if (ee || !ent) return NextResponse.json({ error: ee?.message || "Couldn't save profile" }, { status: 500 });

  const { error: ae } = await supabase.from("accounts").insert({ list_id: listId, entity_id: ent.id });
  if (ae) return NextResponse.json({ error: ae.message }, { status: 500 });

  return NextResponse.json({ ok: true, entityId: ent.id });
}
