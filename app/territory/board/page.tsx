import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import Board from "./Board";

export default async function BoardPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = me?.role === "admin";

  return (
    <Shell active="accounts" isAdmin={isAdmin}>
      <h1>Territory <span style={{ color: "var(--red)" }}>Board</span></h1>
      <div className="seg" style={{ margin: "10px 0 12px" }}>
        <Link href="/territory">Book</Link>
        <Link href="/territory/board" className="on">Board</Link>
        <Link href="/territory/map">Map</Link>
        <Link href="/territory/whitespace">Whitespace</Link>
      </div>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>
        Your accounts scored into tiers on financial signals, plus a side-by-side workbench. Figures from SEC EDGAR — verify against filings.
      </p>
      <Board />
    </Shell>
  );
}
