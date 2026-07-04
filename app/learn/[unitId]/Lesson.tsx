"use client";
import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Body = {
  prompt?: string; whatItIs?: string; whyItMatters?: string;
  link?: string; linkLabel?: string; utility?: string; utilityLabel?: string;
  worked?: string; workedLabel?: string;
} | null;
type Card = { id: string; front: string; body_json: Body };

export default function Lesson({
  unitTitle, unitIcon, cards, userId, masteredIds,
}: {
  unitTitle: string; unitIcon: string | null; cards: Card[]; userId: string; masteredIds: string[];
}) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [mastered, setMastered] = useState<Set<string>>(new Set(masteredIds));
  const [saving, setSaving] = useState(false);
  const supabase = createClient();

  if (cards.length === 0) {
    return <main className="container"><p>No cards in this unit.</p><Link href="/learn">← Back to path</Link></main>;
  }

  if (i >= cards.length) {
    const count = cards.filter((c) => mastered.has(c.id)).length;
    return (
      <main className="container">
        <h1>{unitIcon} {unitTitle}</h1>
        <div className="card">
          <p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nice work! 🎉</p>
          <p>You&apos;ve mastered <b>{count}</b> of <b>{cards.length}</b> cards in this unit — saved to your account.</p>
        </div>
        <p style={{ marginTop: 16, display: "flex", gap: 10 }}>
          <button className="btn" onClick={() => { setI(0); setFlipped(false); }}>Run it again</button>
          <Link href="/learn" className="btn" style={{ background: "var(--charcoal)", textDecoration: "none" }}>Back to path</Link>
        </p>
      </main>
    );
  }

  const card = cards[i];
  const b = card.body_json;

  async function mark(gotIt: boolean) {
    if (gotIt) {
      setSaving(true);
      await supabase.from("progress").upsert(
        { user_id: userId, card_id: card.id, status: "mastered", updated_at: new Date().toISOString() },
        { onConflict: "user_id,card_id" }
      );
      setMastered((prev) => new Set(prev).add(card.id));
      setSaving(false);
    }
    setFlipped(false);
    setI(i + 1);
  }

  return (
    <main className="container">
      <p style={{ fontSize: 13 }}><Link href="/learn">← Path</Link> · card {i + 1} of {cards.length}</p>
      <h2 style={{ fontSize: 16, margin: "4px 0 12px" }}>{unitIcon} {unitTitle}</h2>

      <div className="card" onClick={() => setFlipped((f) => !f)} style={{ cursor: "pointer", minHeight: 240 }}>
        {!flipped ? (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 210 }}>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{card.front}</div>
            {b?.prompt && <p style={{ color: "var(--ink2)", marginTop: 10, fontSize: 15 }}>{b.prompt}</p>}
            <p style={{ marginTop: "auto", fontSize: 12, fontWeight: 700, color: "#8A7E6E" }}>Tap to flip</p>
          </div>
        ) : (
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{card.front}</div>
            {b?.whatItIs && <p style={{ margin: "6px 0" }}><b style={{ color: "var(--blue,#0572CE)" }}>What it is:</b> {b.whatItIs}</p>}
            {b?.whyItMatters && <p style={{ margin: "6px 0" }}><b style={{ color: "var(--purple,#6A3E8E)" }}>Why it matters:</b> {b.whyItMatters}</p>}
            {b?.link && <p style={{ margin: "6px 0" }}><b>{b.linkLabel || "Link"}:</b> {b.link}</p>}
            {b?.utility && <p style={{ margin: "6px 0" }}><b>{b.utilityLabel || "⚡ Utility lens"}:</b> {b.utility}</p>}
            {b?.worked && (
              <p style={{ margin: "6px 0", background: "#F7F2E9", borderLeft: "3px solid var(--gold)", borderRadius: 6, padding: "8px 10px" }}>
                <b>{b.workedLabel || "🧮 Worked example"}:</b> {b.worked}
              </p>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 16, justifyContent: "center" }}>
        <button className="btn" style={{ background: "#fff", color: "#9A6700", border: "2px solid #9A6700" }} onClick={() => mark(false)}>↩ Review</button>
        <button className="btn" style={{ background: "var(--charcoal)" }} onClick={() => setFlipped((f) => !f)}>⟳ Flip</button>
        <button className="btn" style={{ background: "#1B7A47" }} disabled={saving} onClick={() => mark(true)}>✓ Got it</button>
      </div>
      {mastered.has(card.id) && (
        <p style={{ textAlign: "center", color: "#1B7A47", marginTop: 8, fontSize: 12 }}>Already mastered ✓</p>
      )}
    </main>
  );
}
