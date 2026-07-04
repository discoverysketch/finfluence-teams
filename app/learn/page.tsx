import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";

type Body = {
  prompt?: string; whatItIs?: string; whyItMatters?: string;
  link?: string; linkLabel?: string; utility?: string; utilityLabel?: string;
  worked?: string; workedLabel?: string;
} | null;
type Card = { id: string; front: string; body_json: Body; cseq: number };
type Unit = { id: string; title: string; icon: string | null; seq: number; cards: Card[] };

export default async function Learn() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: pack } = await supabase
    .from("content_packs").select("id,name").eq("is_default", true).maybeSingle();

  if (!pack) {
    return (
      <main className="container">
        <h1>Learn</h1>
        <div className="card">
          No content pack yet. Run <code>npm run seed</code> to load the curriculum, then refresh.
        </div>
        <p style={{ marginTop: 16 }}><Link href="/">← Home</Link></p>
      </main>
    );
  }

  const { data } = await supabase
    .from("units")
    .select("id,title,icon,seq:order,cards(id,front,body_json,cseq:order)")
    .eq("pack_id", pack.id);
  const units = ((data ?? []) as unknown as Unit[]).slice().sort((a, b) => a.seq - b.seq);

  const Section = ({ label, text }: { label: string; text?: string }) =>
    text ? (
      <p style={{ margin: "6px 0" }}>
        <b style={{ color: "var(--ink2)" }}>{label}:</b> {text}
      </p>
    ) : null;

  return (
    <main className="container" style={{ maxWidth: 640 }}>
      <p><Link href="/">← Home</Link></p>
      <h1>Fin<span style={{ color: "var(--red)" }}>Fluency</span> · {pack.name}</h1>
      <p style={{ color: "var(--ink2)", fontSize: 13 }}>
        {units.length} units · {units.reduce((n, u) => n + u.cards.length, 0)} cards — loaded from the database.
      </p>
      {units.map((u) => (
        <section key={u.id} style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 18 }}>{u.icon} {u.title}</h2>
          {u.cards.slice().sort((a, b) => a.cseq - b.cseq).map((c) => (
            <details key={c.id} className="card" style={{ marginBottom: 8 }}>
              <summary style={{ cursor: "pointer", fontWeight: 700 }}>
                {c.front}
                {c.body_json?.prompt ? <span style={{ fontWeight: 400, color: "var(--ink2)" }}> — {c.body_json.prompt}</span> : null}
              </summary>
              <div style={{ marginTop: 8 }}>
                <Section label="What it is" text={c.body_json?.whatItIs} />
                <Section label="Why it matters" text={c.body_json?.whyItMatters} />
                <Section label={c.body_json?.linkLabel || "Link"} text={c.body_json?.link} />
                <Section label={c.body_json?.utilityLabel || "Utility lens"} text={c.body_json?.utility} />
                <Section label={c.body_json?.workedLabel || "Worked example"} text={c.body_json?.worked} />
              </div>
            </details>
          ))}
        </section>
      ))}
    </main>
  );
}
