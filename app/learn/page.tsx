import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import StoryShowcase from "@/components/StoryShowcase";
import { STORY_UNIT_RE } from "@/lib/storySweep";

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
  // Customer stories are selling ammunition, not curriculum — pull them out of
  // the path lists into their own showcase section.
  const isStoryUnit = (u: Unit) => STORY_UNIT_RE.test(u.title);
  const storyUnits = units.filter(isStoryUnit);
  const core = units.filter((u) => u.is_seeded && !isStoryUnit(u));
  const custom = units.filter((u) => !u.is_seeded && !isStoryUnit(u));

  // Sample customer names + covered list for the showcase (fronts are
  // "Customer — product").
  const storyIds = storyUnits.map((u) => u.id);
  const { data: storyCards } = storyIds.length
    ? await supabase.from("cards").select("front, unit_id").in("unit_id", storyIds)
    : { data: [] as { front: string; unit_id: string }[] };
  const customers = [...new Set(((storyCards ?? []) as { front: string }[]).map((c) => String(c.front).split("—")[0].trim()).filter((s) => s.length > 2))];
  const iconOf = Object.fromEntries(units.map((u) => [u.id, u.icon]));

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
      {storyUnits.length > 0 && (
        <StoryShowcase
          units={storyUnits.map((u) => ({ id: u.id, title: u.title, icon: iconOf[u.id] ?? null, count: u.cards.length }))}
          targetUnitId={storyUnits.find((u) => /customer stor/i.test(u.title))?.id ?? null}
          covered={customers}
          samples={customers.slice(0, 8)}
          isAdmin={isAdmin}
        />
      )}
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
