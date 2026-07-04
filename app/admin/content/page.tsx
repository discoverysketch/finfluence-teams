import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import ContentEditor from "./ContentEditor";

export default async function AdminContentPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") {
    return (
      <main className="container">
        <h1>Content editor</h1>
        <div className="card">Admins only. Your role is <b>{profile?.role ?? "—"}</b>.</div>
        <p style={{ marginTop: 16 }}><Link href="/">← Home</Link></p>
      </main>
    );
  }

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <p style={{ fontSize: 13 }}><Link href="/">← Home</Link></p>
      <h1>Content <span style={{ color: "var(--red)" }}>editor</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13 }}>Edits go straight to the database and appear in the learning path immediately.</p>
      <ContentEditor />
    </main>
  );
}
