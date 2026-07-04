// Phase 2 exit test: two tenants, fully isolated content + users (RLS).
// Creates two throwaway tenants/users, seeds data, signs in as each via the ANON
// key (so RLS applies), asserts isolation, then deletes everything. Run:
//   node --env-file=.env.local seed/test-isolation.mjs
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !service || !anon) { console.error("Missing URL / service / anon key in .env.local"); process.exit(1); }
const admin = createClient(url, service, { auth: { persistSession: false } });

const results = [];
const rec = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`${pass ? "✅" : "❌"} ${name}${detail ? " — " + detail : ""}`); };

const sfx = Date.now().toString(36);
const emailA = `iso-a-${sfx}@example.com`, emailB = `iso-b-${sfx}@example.com`, pass = `Iso-${sfx}-Pw1!`;
let tenantA, tenantB, userAId, userBId, packB;

const ins = async (t, row, sel = "id") => { const { data, error } = await admin.from(t).insert(row).select(sel).single(); if (error) throw new Error(`${t}: ${error.message}`); return data; };

try {
  tenantA = (await ins("tenants", { name: `IsoA ${sfx}` })).id;
  tenantB = (await ins("tenants", { name: `IsoB ${sfx}` })).id;
  const packA = (await ins("content_packs", { tenant_id: tenantA, name: "PackA", is_default: true })).id;
  packB = (await ins("content_packs", { tenant_id: tenantB, name: "PackB", is_default: true })).id;
  await ins("units", { pack_id: packA, title: `A-UNIT-${sfx}`, order: 0, is_seeded: true });
  await ins("units", { pack_id: packB, title: `B-UNIT-${sfx}`, order: 0, is_seeded: true });
  const listA = (await ins("account_lists", { tenant_id: tenantA, name: "ListA" })).id;
  const listB = (await ins("account_lists", { tenant_id: tenantB, name: "ListB" })).id;
  await ins("accounts", { list_id: listA });
  await ins("accounts", { list_id: listB });

  userAId = (await admin.auth.admin.createUser({ email: emailA, password: pass, email_confirm: true })).data.user.id;
  userBId = (await admin.auth.admin.createUser({ email: emailB, password: pass, email_confirm: true })).data.user.id;
  await ins("users", { id: userAId, tenant_id: tenantA, email: emailA, role: "admin" });
  await ins("users", { id: userBId, tenant_id: tenantB, email: emailB, role: "admin" });

  const ca = createClient(url, anon, { auth: { persistSession: false } });
  const cb = createClient(url, anon, { auth: { persistSession: false } });
  const sa = await ca.auth.signInWithPassword({ email: emailA, password: pass });
  const sb = await cb.auth.signInWithPassword({ email: emailB, password: pass });
  if (sa.error || sb.error) throw new Error(`sign-in: ${sa.error?.message || sb.error?.message}`);

  const aUnits = (await ca.from("units").select("title")).data || [];
  const bUnits = (await cb.from("units").select("title")).data || [];
  rec("A sees its own unit", aUnits.some((u) => u.title === `A-UNIT-${sfx}`));
  rec("A does NOT see B's unit", !aUnits.some((u) => u.title === `B-UNIT-${sfx}`), `A sees ${aUnits.length} unit(s)`);
  rec("B does NOT see A's unit", !bUnits.some((u) => u.title === `A-UNIT-${sfx}`), `B sees ${bUnits.length} unit(s)`);

  const aLists = (await ca.from("account_lists").select("tenant_id")).data || [];
  rec("A sees only its own account lists", aLists.length > 0 && aLists.every((l) => l.tenant_id === tenantA));

  const aReadsBpack = (await ca.from("content_packs").select("id").eq("id", packB)).data || [];
  rec("A cannot read B's content pack by id", aReadsBpack.length === 0);

  const shared = await ca.from("entities").select("id", { count: "exact", head: true }).is("created_by_tenant", null);
  rec("A sees the shared directory", (shared.count || 0) > 0, `${shared.count} shared entities`);

  const hack = await ca.from("units").insert({ pack_id: packB, title: "HACK", order: 99 });
  const blocked = !!hack.error || (Array.isArray(hack.data) && hack.data.length === 0);
  rec("A cannot write into B's pack", blocked, hack.error ? hack.error.message.slice(0, 48) : "insert returned no row (RLS)");
} catch (e) {
  rec("test harness ran without throwing", false, e.message);
} finally {
  try { if (userAId) await admin.from("users").delete().eq("id", userAId); } catch {}
  try { if (userBId) await admin.from("users").delete().eq("id", userBId); } catch {}
  try { if (tenantA) await admin.from("tenants").delete().eq("id", tenantA); } catch {}
  try { if (tenantB) await admin.from("tenants").delete().eq("id", tenantB); } catch {}
  try { if (userAId) await admin.auth.admin.deleteUser(userAId); } catch {}
  try { if (userBId) await admin.auth.admin.deleteUser(userBId); } catch {}
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\ncleanup done · ${failed ? `❌ ${failed} CHECK(S) FAILED` : `✅ ALL ${results.length} CHECKS PASSED`}`);
  process.exit(failed ? 1 : 0);
}
