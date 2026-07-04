import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";

type Card = { id: string; cseq: number };
type Unit = { id: string; title: string; icon: string | null; seq: number; is_seeded: boolean; cards: Card[] };

export default async function Learn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";

  const { data: pack } = await supabase
    .from("content_packs").select("id,name").eq("is_default", true).maybeSingle();

  if (!pack) {
    return (
      <Shell active="path" isAdmin={isAdmin}>
        <h1>Learn</h1>
        <div className="card">No content pack yet. Run <code>npm run seed</code>, then refresh.</div>
      </Shell>
    );
  }

  const { data } = await supabase
    .from("units").select("id,title,icon,seq:order,is_seeded,cards(id,cseq:order)").eq("pack_id", pack.id);
  const units = ((data ?? []) as unknown as Unit[]).slice().sort((a, b) => a.seq - b.seq);
  const core = units.filter((u) => u.is_seeded);
  const custom = units.filter((u) => !u.is_seeded);

  const { data: prog } = await supabase.from("progress").select("card_id").eq("status", "mastered");
  const masteredSet = new Set(((prog ?? []) as { card_id: string }[]).map((p) => p.card_id));

  const total = core.reduce((n, u) => n + u.cards.length, 0);
  const masteredTotal = core.reduce((n, u) => n + u.cards.filter((c) => masteredSet.has(c.id)).length, 0);

  const UnitCard = (u: Unit) => {
    const m = u.cards.filter((c) => masteredSet.has(c.id)).length;
    const pct = u.cards.length ? Math.round((m / u.cards.length) * 100) : 0;
    const done = m === u.cards.length && u.cards.length > 0;
    return (
      <Link key={u.id} href={`/learn/${u.id}`} style={{ color: "inherit" }}>
        <div className="card" style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <div style={{ fontSize: 24, width: 34, textAlign: "center" }}>{u.icon}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700 }}>{u.title}</div>
            <div style={{ height: 6, background: "var(--cream2)", borderRadius: 4, marginTop: 6, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold)" }} />
            </div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4 }}>{m} / {u.cards.length} mastered</div>
          </div>
          <div style={{ fontSize: 18 }}>{done ? "✅" : "›"}</div>
        </div>
      </Link>
    );
  };

  return (
    <Shell active="path" isAdmin={isAdmin}>
      <h1>Your <span style={{ color: "var(--red)" }}>path</span></h1>
      <p style={{ color: "var(--ink2)", fontSize: 13, marginTop: 0 }}>{masteredTotal} / {total} cards mastered</p>
      {core.map((u) => UnitCard(u))}
      {custom.length > 0 && (
        <>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", margin: "26px 0 2px" }}>
            Your team&apos;s concepts <span style={{ color: "var(--muted)", fontWeight: 600, textTransform: "none", letterSpacing: 0 }}>· practice</span>
          </div>
          {custom.map((u) => UnitCard(u))}
        </>
      )}
    </Shell>
  );
}
