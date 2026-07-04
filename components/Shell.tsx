import Link from "next/link";
import Finn from "./Finn";
import MuteButton from "./MuteButton";
import { createClient } from "@/lib/supabase/server";
import { overallAcumen, tier, level, type Ev } from "@/lib/acumen";

type Tab = "home" | "path" | "challenge" | "accounts" | "content";
/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function Shell({
  active, isAdmin, children,
}: { active: Tab; isAdmin?: boolean; children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  let acumen = 0, mode = "playful";
  if (user) {
    const [{ data: prof }, { data: events }, { count: mastered }] = await Promise.all([
      supabase.from("users").select("tenant_id, tenants(display_mode)").eq("id", user.id).maybeSingle(),
      supabase.from("score_events").select("concept_tag,correct").eq("user_id", user.id),
      // Only seeded (core) cards count toward Acumen; custom concepts are practice-only.
      supabase.from("progress").select("cards!inner(is_seeded)", { count: "exact", head: true }).eq("status", "mastered").eq("user_id", user.id).eq("cards.is_seeded", true),
    ]);
    const t: any = (prof as any)?.tenants;
    mode = (Array.isArray(t) ? t[0]?.display_mode : t?.display_mode) || "playful";
    acumen = overallAcumen((events ?? []) as Ev[], mastered || 0);
  }
  const lv = level(acumen);
  const tr = tier(acumen);

  const cls = (t: Tab) => (active === t ? "on" : "");
  return (
    <>
      <header className="appbar">
        <Finn />
        {mode === "professional" ? (
          <>
            <div className="lvl">Acumen <b>{acumen}</b></div>
            <span style={{ background: tr.color, color: "#fff", fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "3px 9px" }}>{tr.name}</span>
            <div className="spacer" style={{ flex: 1 }} />
          </>
        ) : (
          <>
            <div className="lvl">Lv <b>{lv.level}</b></div>
            <div className="xpwrap"><div className="xpbar" style={{ width: `${lv.pct}%` }} /></div>
          </>
        )}
        <MuteButton />
      </header>
      <main className="container">{children}</main>
      <nav className="nav">
        <Link href="/learn" className={cls("path")}><span className="ni">🗺️</span>Path</Link>
        <Link href="/challenge" className={cls("challenge")}><span className="ni">🎯</span>Challenge</Link>
        <Link href="/territory" className={cls("accounts")}><span className="ni">🏢</span>Accounts</Link>
        {isAdmin && <Link href="/admin/content" className={cls("content")}><span className="ni">✏️</span>Content</Link>}
        <Link href="/" className={cls("home")}><span className="ni">👤</span>Me</Link>
      </nav>
    </>
  );
}
