"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Sparkles, X } from "lucide-react";

// First-run checklist on My Day. Steps are derived server-side from real data
// (book, progress, score events, push subscription) — no onboarding tables.
// Hides itself once everything's done, or when dismissed (localStorage).
export type OnboardStep = { key: string; label: string; desc: string; href: string; done: boolean };
const DISMISS_KEY = "accountfluency_onboarding_dismissed";

export default function GettingStarted({ steps }: { steps: OnboardStep[] }) {
  const [hidden, setHidden] = useState(true); // avoid flash before localStorage read
  useEffect(() => { setHidden(localStorage.getItem(DISMISS_KEY) === "1"); }, []);

  const doneCount = steps.filter((s) => s.done).length;
  if (hidden || doneCount === steps.length) return null;

  return (
    <div className="card" style={{ marginTop: 14, background: "#FAF6EE", borderColor: "#E6CF94" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Sparkles size={15} strokeWidth={2.2} color="#9A6700" />
        <span style={{ flex: 1, fontSize: 13, fontWeight: 800, color: "#7A5B12" }}>
          Getting started · {doneCount} of {steps.length}
        </span>
        <button aria-label="Dismiss" onClick={() => { localStorage.setItem(DISMISS_KEY, "1"); setHidden(true); }}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#9A6700", padding: 2 }}>
          <X size={15} />
        </button>
      </div>
      <div style={{ height: 6, background: "#F0E4C8", borderRadius: 4, overflow: "hidden", marginBottom: 10 }}>
        <div style={{ width: `${(doneCount / steps.length) * 100}%`, height: "100%", background: "var(--gold)", transition: "width .3s" }} />
      </div>
      {steps.map((s) => (
        <Link key={s.key} href={s.href} style={{ color: "inherit", display: "block" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 2px", opacity: s.done ? 0.55 : 1 }}>
            <span style={{
              width: 20, height: 20, borderRadius: "50%", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
              background: s.done ? "var(--green)" : "#fff", border: s.done ? "none" : "2px solid #D8C89A",
              color: "#fff", fontSize: 12, fontWeight: 800,
            }}>{s.done ? "✓" : ""}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 700, textDecoration: s.done ? "line-through" : "none" }}>{s.label}</div>
              {!s.done && <div style={{ fontSize: 11.5, color: "var(--ink2)" }}>{s.desc}</div>}
            </div>
            {!s.done && <span style={{ fontSize: 15, color: "#9A6700" }}>›</span>}
          </div>
        </Link>
      ))}
    </div>
  );
}
