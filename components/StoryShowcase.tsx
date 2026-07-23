"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { STORY_BUCKETS, customerOf, searchStories } from "@/lib/storySweep";

// Path showcase for customer stories: the selling ammunition, front and
// center — browse the decks, and (admins) grow the library right here with a
// topic search or the full sweep.
type StoryUnit = { id: string; title: string; icon: string | null; count: number };

export default function StoryShowcase({ units, targetUnitId, covered, samples, isAdmin }: {
  units: StoryUnit[]; targetUnitId: string | null; covered: string[]; samples: string[]; isAdmin: boolean;
}) {
  const supabase = createClient();
  const router = useRouter();
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [added, setAdded] = useState<number | null>(null);
  const [err, setErr] = useState("");

  const total = units.reduce((n, u) => n + u.count, 0);

  async function run(full: boolean) {
    if (!targetUnitId || busy) return;
    setBusy(true); setErr(""); setAdded(null);
    const cov = new Set(covered.map((c) => c.toLowerCase()));
    let sum = 0;
    try {
      const { count } = await supabase.from("cards").select("id", { count: "exact", head: true }).eq("unit_id", targetUnitId);
      let order = count ?? 0;
      const jobs: [string, string][] = full ? STORY_BUCKETS : [["your topic", topic.trim()]];
      for (let i = 0; i < jobs.length; i++) {
        setStage(full ? `${i + 1}/${jobs.length} · ${jobs[i][0]}` : `searching “${topic.trim()}”`);
        const res = await searchStories({ supabase, unitId: targetUnitId, topic: jobs[i][1], covered: cov, startOrder: order });
        sum += res.added; order += res.added;
        setAdded(sum);
        if (!full && res.error && !res.added) setErr(res.error);
      }
    } catch { setErr("Search failed — try again."); }
    setStage(""); setBusy(false); setAdded(sum);
    if (sum > 0) router.refresh();
  }

  return (
    <div style={{ margin: "26px 0 4px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: "#006B72", textTransform: "uppercase", letterSpacing: ".6px", marginBottom: 6 }}>
        📚 Customer stories · {total} on file
      </div>
      <div className="card" style={{ background: "linear-gradient(135deg, #F0F7F7, #FAF6EE)", borderColor: "#C4DEDF", padding: "14px 16px" }}>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: "0 0 8px", lineHeight: 1.5 }}>
          Real, sourced wins to retell in your next meeting — the proof behind every pitch. These also power the CFO coach and Meeting Wingman.
        </p>
        {samples.length > 0 && (
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 10 }}>
            {samples.map((s) => (
              <span key={s} style={{ background: "#fff", border: "1px solid #D9E7E7", color: "#006B72", fontSize: 11, fontWeight: 700, borderRadius: 12, padding: "3px 10px" }}>{s}</span>
            ))}
            {total > samples.length && <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, padding: "3px 2px" }}>+{total - samples.length} more</span>}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {units.map((u) => (
            <Link key={u.id} href={`/learn/${u.id}`} className="btn" style={{ background: "var(--teal)", padding: "9px 14px", fontSize: 13, textDecoration: "none" }}>
              {u.icon || "📚"} {u.title.replace(/^Use Cases:\s*/i, "")} ({u.count}) →
            </Link>
          ))}
        </div>

        {isAdmin && targetUnitId && (
          <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #D9E7E7" }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} disabled={busy}
                placeholder="Find stories about… e.g. Primavera outages, EPM close, water utilities"
                style={{ flex: 1, minWidth: 200, fontSize: 13 }} />
              <button className="mini" disabled={busy || topic.trim().length < 3} onClick={() => run(false)} style={{ fontWeight: 700 }}>
                🔎 Search
              </button>
              <button className="mini" disabled={busy} onClick={() => run(true)} style={{ fontWeight: 700 }}>
                Full sweep
              </button>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--ink2)", marginTop: 6 }}>
              {busy
                ? `Searching ${stage}… ${added ? `· ${added} new saved` : ""} (~1-2 min per search)`
                : added != null
                  ? (added > 0 ? `✓ ${added} new stor${added === 1 ? "y" : "ies"} added — every one carries its source.` : "Nothing new found — the library already covers what's reachable on that topic.")
                  : "New finds save into the library instantly (deduped by customer, always sourced)."}
              {err && <span style={{ color: "var(--red)" }}> {err}</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
