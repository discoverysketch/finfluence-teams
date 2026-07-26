import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import ContentEditor from "./ContentEditor";

export default async function AdminContentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return (
      <Shell active="content">
        <h1>Content editor</h1>
        <div className="card">Admins only. Your role is <b>{profile?.role ?? "—"}</b>.</div>
      </Shell>
    );
  }

  // Content is one of the five nav tabs, so it must render the nav like every
  // other tab — without it a rep lands here and has no way back but the
  // browser's back button.
  return (
    <Shell active="content" isAdmin>
      <h1>Content <span style={{ color: "var(--red)" }}>editor</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13 }}>Edits go straight to the database and appear in the learning path immediately.</p>
      <ContentEditor />
    </Shell>
  );
}
