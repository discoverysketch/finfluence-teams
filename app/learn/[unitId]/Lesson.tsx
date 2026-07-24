"use client";
import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { SFX, sparkle, unlockAudio } from "@/lib/sfx";

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
  const supabase = createClient();
  const flipRef = useRef<HTMLDivElement>(null);
  const yesRef = useRef<HTMLDivElement>(null);
  const noRef = useRef<HTMLDivElement>(null);
  const drag = useRef({ sx: 0, sy: 0, dx: 0, on: false, moved: false, scroll: false, captured: false, pid: 0, busy: false });

  if (cards.length === 0) {
    return <main className="container"><p>No cards in this unit.</p><Link href="/learn">← Back to path</Link></main>;
  }

  if (i >= cards.length) {
    const count = cards.filter((c) => mastered.has(c.id)).length;
    return (
      <main className="container" style={{ textAlign: "center" }}>
        <h1>{unitIcon} {unitTitle}</h1>
        <div className="card"><p style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Nice work! 🎉</p>
          <p>You&apos;ve mastered <b>{count}</b> of <b>{cards.length}</b> cards — saved to your account.</p></div>
        <p style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center" }}>
          <button className="btn" onClick={() => { setI(0); setFlipped(false); }}>Run it again</button>
          <Link href="/learn" className="btn" style={{ background: "var(--charcoal)" }}>Back to path</Link>
        </p>
      </main>
    );
  }

  const card = cards[i];
  const b = card.body_json;
  // Customer-story cards embed their citation as "Source: <url>" (usually in
  // the worked field). Pull it out to a proper clickable link and strip the
  // raw URL from the body text so it reads clean.
  const srcUrl = [b?.worked, b?.utility, b?.whyItMatters, b?.link].map((t) => t?.match(/https?:\/\/[^\s)"']+/)?.[0]).find(Boolean) || null;
  const clean = (t?: string) => (t ? t.replace(/\s*(?:·\s*)?Source:?\s*https?:\/\/[^\s)"']+/i, "").replace(/\s*https?:\/\/[^\s)"']+/i, "").trim() : t);
  // Story cards live in the "…Stories/Wins/Win Wire" units. Those without a
  // stored URL get a search fallback so every story reaches its real source.
  const isStory = /customer stor|win wire|\bwins\b/i.test(unitTitle);
  const custName = card.front.split("—")[0].replace(/^WIN:\s*/i, "").trim();
  const searchUrl = isStory && !srcUrl && custName ? `https://www.google.com/search?q=${encodeURIComponent(`${custName} Oracle customer story`)}` : null;

  function reset(el: HTMLDivElement | null) {
    if (el) { el.style.transition = "transform .35s, opacity .35s"; el.style.transform = ""; el.style.opacity = "1"; }
    if (yesRef.current) yesRef.current.style.opacity = "0";
    if (noRef.current) noRef.current.style.opacity = "0";
  }
  function onDown(e: React.PointerEvent<HTMLDivElement>) {
    if (drag.current.busy) return;
    // Don't capture the pointer yet — capturing here would steal a vertical
    // scroll. We only capture once the gesture proves to be a horizontal swipe.
    drag.current = { sx: e.clientX, sy: e.clientY, dx: 0, on: true, moved: false, scroll: false, captured: false, pid: e.pointerId, busy: false };
  }
  function onMove(e: React.PointerEvent<HTMLDivElement>) {
    const d = drag.current; if (!d.on || d.scroll) return;
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (!d.moved) {
      // Decide intent on first real movement: vertical => let the page scroll.
      if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) { d.scroll = true; return; }
      if (Math.abs(dx) > 8) {
        d.moved = true;
        const el = flipRef.current; if (el) { el.style.transition = "none"; el.setPointerCapture?.(d.pid); d.captured = true; }
      } else return;
    }
    d.dx = dx;
    const el = flipRef.current; if (el) el.style.transform = `translate(${dx}px, ${Math.abs(dx) * 0.04}px) rotate(${dx * 0.05}deg)`;
    if (yesRef.current) yesRef.current.style.opacity = String(dx > 0 ? Math.min(dx / 90, 1) : 0);
    if (noRef.current) noRef.current.style.opacity = String(dx < 0 ? Math.min(-dx / 90, 1) : 0);
  }
  function onUp() {
    const d = drag.current; if (!d.on) return; d.on = false;
    if (d.scroll) return; // was a scroll, not a card gesture
    const el = flipRef.current;
    if (!d.moved) { setFlipped((f) => !f); reset(el); try { unlockAudio(); SFX.flip(); } catch { /* audio optional */ } return; }
    if (d.dx > 90) commit(1);
    else if (d.dx < -90) commit(-1);
    else reset(el);
  }
  function commit(dir: 1 | -1) {
    drag.current.busy = true;
    const el = flipRef.current;
    if (el) { el.style.transition = "transform .35s, opacity .35s"; el.style.transform = `translate(${dir * 600}px, ${dir * 40}px) rotate(${dir * 30}deg)`; el.style.opacity = "0"; }
    setTimeout(() => finish(dir), 300);
  }
  async function finish(dir: 1 | -1) {
    if (dir > 0) {
      await supabase.from("progress").upsert(
        { user_id: userId, card_id: card.id, status: "mastered", updated_at: new Date().toISOString() },
        { onConflict: "user_id,card_id" });
      setMastered((prev) => new Set(prev).add(card.id));
      SFX.correct();
      if (typeof window !== "undefined") sparkle(window.innerWidth / 2, window.innerHeight * 0.4);
    } else { SFX.wrong(); }
    const last = i + 1 >= cards.length;
    setFlipped(false);
    setI(i + 1);
    drag.current.busy = false;
    if (last) SFX.win();
  }

  return (
    <main className="container" style={{ display: "flex", flexDirection: "column", minHeight: "calc(100vh - 130px)" }}>
      <p style={{ fontSize: 13 }}><Link href="/learn">← Path</Link> · card {i + 1} of {cards.length}{mastered.has(card.id) && <span style={{ color: "#1B7A47" }}> · mastered ✓</span>}</p>
      <h2 style={{ fontSize: 15, margin: "0 0 4px" }}>{unitIcon} {unitTitle}</h2>

      <div className="stage">
        <div className="flip" key={i} ref={flipRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          <div className="stamp yes" ref={yesRef}>GOT IT</div>
          <div className="stamp no" ref={noRef}>REVIEW</div>
          <div className={`flip-inner ${flipped ? "flipped" : ""}`}>
            <div className="face front">
              <div className="term">{card.front}</div>
              <div className="rule" />
              {b?.prompt && <div className="prompt">{b.prompt}</div>}
              <div className="tapper">Tap to <b style={{ color: "var(--red)" }}>flip</b> · swipe to answer</div>
            </div>
            <div className="face back">
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{card.front}</div>
              <div className="rule" />
              {b?.whatItIs && <p style={{ margin: "6px 0", fontSize: 14 }}><b style={{ color: "var(--blue)" }}>What it is:</b> {clean(b.whatItIs)}</p>}
              {b?.whyItMatters && <p style={{ margin: "6px 0", fontSize: 14 }}><b style={{ color: "var(--purple)" }}>Why it matters:</b> {clean(b.whyItMatters)}</p>}
              {b?.link && !/https?:\/\//.test(b.link) && <p style={{ margin: "6px 0", fontSize: 14 }}><b>{b.linkLabel || "Link"}:</b> {b.link}</p>}
              {b?.utility && <p style={{ margin: "6px 0", fontSize: 14 }}><b>{b.utilityLabel || "⚡ Utility lens"}:</b> {clean(b.utility)}</p>}
              {b?.worked && clean(b.worked) && <p style={{ margin: "6px 0", fontSize: 14, background: "#F7F2E9", borderLeft: "3px solid var(--gold)", borderRadius: 6, padding: "8px 10px" }}><b>{b.workedLabel || "🧮 Worked example"}:</b> {clean(b.worked)}</p>}
              {(srcUrl || searchUrl) && (
                <p style={{ margin: "8px 0 0", fontSize: 13 }}>
                  <a href={srcUrl || searchUrl!} target="_blank" rel="noreferrer" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}
                    style={{ color: "var(--blue)", fontWeight: 700, textDecoration: "none" }}>
                    {srcUrl ? "📎 Read the source ↗" : "🔎 Find the source ↗"}
                  </a>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 14, justifyContent: "center", padding: "14px 0" }}>
        <button aria-label="Review" onClick={() => commit(-1)} style={btn("#fff", "#9A6700", "2px solid #9A6700")}>↩</button>
        <button aria-label="Flip" onClick={() => { unlockAudio(); SFX.flip(); setFlipped((f) => !f); }} style={btn("var(--red)", "#fff")}>⟳</button>
        <button aria-label="Got it" onClick={() => commit(1)} style={btn("#1B7A47", "#fff")}>✓</button>
      </div>
    </main>
  );
}

function btn(bg: string, color: string, border = "none"): React.CSSProperties {
  return { background: bg, color, border, borderRadius: "50%", width: 56, height: 56, fontSize: 22, fontWeight: 700, cursor: "pointer", boxShadow: "0 6px 16px rgba(40,30,15,.22)" };
}
