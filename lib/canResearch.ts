// "May this user spend money researching this account?"
//
// Reading is open — every rep sees every account's cached research, which is
// the point of a shared team book. RUNNING research is not: it costs money,
// writes to the shared directory, and is the assigned rep's call. Admins and
// managers can research anything.
//
// Enforced server-side because the UI hiding a button stops nobody from
// POSTing to the route directly.
import type { SupabaseClient } from "@supabase/supabase-js";
/* eslint-disable @typescript-eslint/no-explicit-any */

export type ResearchGate = { ok: true } | { ok: false; reason: string };

type By = { entityId?: string; accountId?: string; contactId?: string };

export async function canResearch(supabase: SupabaseClient, userId: string, by: By): Promise<ResearchGate> {
  const { data: me } = await supabase.from("users").select("role").eq("id", userId).maybeSingle();
  if (me?.role === "admin" || me?.role === "manager") return { ok: true };

  // Resolve to the account(s) this request touches. RLS already scopes these
  // reads to the caller's tenant, so anything found here is in their book.
  let accountId = by.accountId ?? null;
  if (!accountId && by.contactId) {
    const { data: c } = await supabase.from("contacts").select("account_id").eq("id", by.contactId).maybeSingle();
    accountId = (c as any)?.account_id ?? null;
  }

  if (accountId) {
    const { data: a } = await supabase.from("accounts").select("owner").eq("id", accountId).maybeSingle();
    if (!a) return { ok: false, reason: "That account isn't in your book." };
    return (a as any).owner === userId
      ? { ok: true }
      : { ok: false, reason: "This account isn't assigned to you — ask an admin to assign it if you need to research it." };
  }

  if (by.entityId) {
    // An entity can back more than one account row; owning any of them is enough.
    const { data: rows } = await supabase.from("accounts").select("owner").eq("entity_id", by.entityId);
    if (!rows?.length) return { ok: false, reason: "That account isn't in your book." };
    if (rows.some((r: any) => r.owner === userId)) return { ok: true };
    const unowned = rows.every((r: any) => !r.owner);
    return {
      ok: false,
      reason: unowned
        ? "This account isn't assigned to anyone yet — ask an admin to assign it."
        : "This account isn't assigned to you — ask an admin to assign it if you need to research it.",
    };
  }

  return { ok: false, reason: "Couldn't tell which account this is for." };
}
