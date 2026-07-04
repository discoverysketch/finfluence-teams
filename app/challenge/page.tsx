import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Shell from "@/components/Shell";
import Challenge from "./Challenge";

export default async function ChallengePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();

  return (
    <Shell active="challenge" isAdmin={profile?.role === "admin"}>
      <h1>Company <span style={{ color: "var(--red)" }}>Challenge</span></h1>
      <Challenge userId={user.id} />
    </Shell>
  );
}
