"use server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";

// Verify the caller is an admin and return their tenant. All mutations gate on this.
async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");
  const { data: me } = await supabase.from("users").select("tenant_id, role").eq("id", user.id).single();
  if (me?.role !== "admin") throw new Error("Admins only");
  return { tenantId: me.tenant_id as string, adminId: user.id };
}

export async function inviteMember(formData: FormData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const role = String(formData.get("role") || "rep");
  if (!email || !["rep", "manager", "admin"].includes(role)) return;
  const { tenantId } = await requireAdmin();
  const admin = createAdminClient();
  const site = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

  let uid: string | undefined;
  const { data: inv, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: `${site}/auth/callback` });
  if (inv?.user) uid = inv.user.id;
  if (!uid && error) {
    // Already has an account — find them and just add to this tenant.
    const { data: list } = await admin.auth.admin.listUsers();
    uid = list?.users?.find((u) => u.email?.toLowerCase() === email)?.id;
  }
  if (uid) {
    await admin.from("users").upsert({ id: uid, tenant_id: tenantId, email, role }, { onConflict: "id" });
  }
  revalidatePath("/admin/team");
}

export async function updateRole(formData: FormData) {
  const id = String(formData.get("id") || "");
  const role = String(formData.get("role") || "rep");
  if (!id || !["rep", "manager", "admin"].includes(role)) return;
  const { tenantId } = await requireAdmin();
  await createAdminClient().from("users").update({ role }).eq("id", id).eq("tenant_id", tenantId);
  revalidatePath("/admin/team");
}

export async function removeMember(formData: FormData) {
  const id = String(formData.get("id") || "");
  const { tenantId, adminId } = await requireAdmin();
  if (!id || id === adminId) return; // can't remove yourself
  await createAdminClient().from("users").delete().eq("id", id).eq("tenant_id", tenantId);
  revalidatePath("/admin/team");
}
