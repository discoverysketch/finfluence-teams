import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Detective from "./Detective";

export default async function DetectivePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  return (
    <Shell active="challenge" isAdmin={me?.role === "admin"}>
      <p style={{ fontSize: 13 }}><Link href="/challenge">← Challenge</Link></p>
      <h1>Metric <span style={{ color: "var(--red)" }}>Detective</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Real financials from one of <b>your</b> accounts, name hidden. Can you tell your accounts apart by their numbers?
      </p>
      <Detective userId={user.id} />
    </Shell>
  );
}
