"use client";
import { useEffect, useRef, useState } from "react";
import { noteFor } from "@/lib/metricGlossary";

// Tap-to-open explainer beside a financial metric. Definitions are STATIC —
// they ship in the bundle, so this costs nothing and works offline. It never
// goes looking anything up.
export default function MetricInfo({ metric, align = "left" }: { metric: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const note = noteFor(metric);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  if (!note) return null;
  return (
    <span ref={box} style={{ position: "relative", display: "inline-flex", verticalAlign: "middle" }}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }}
        aria-label={`What is ${note.label}?`} aria-expanded={open}
        style={{
          width: 15, height: 15, marginLeft: 4, padding: 0, flexShrink: 0,
          borderRadius: "50%", border: "1px solid var(--border)",
          background: open ? "var(--teal)" : "#fff", color: open ? "#fff" : "var(--muted)",
          fontSize: 10, fontWeight: 800, lineHeight: 1, cursor: "pointer", fontFamily: "Georgia, serif",
        }}
      >i</button>
      {open && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute", top: 20, [align]: 0, zIndex: 60, width: "min(300px, 78vw)",
            background: "#fff", border: "1px solid var(--border)", borderRadius: 10,
            boxShadow: "0 8px 28px rgba(45,32,18,.18)", padding: "10px 12px", textAlign: "left",
            fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--ink)",
          }}
        >
          <span style={{ display: "block", fontSize: 12.5, fontWeight: 800, marginBottom: 3 }}>{note.label}</span>
          <span style={{ display: "block", fontSize: 12, lineHeight: 1.5, color: "var(--ink2)" }}>{note.what}</span>
          <span style={{ display: "block", fontSize: 12, lineHeight: 1.5, marginTop: 5 }}>
            <b style={{ color: "#006B72" }}>Why it matters:</b> {note.why}
          </span>
          {note.ask && (
            <span style={{ display: "block", fontSize: 11.5, lineHeight: 1.45, marginTop: 6, paddingTop: 5, borderTop: "1px solid #F0EAE0", color: "#8A6A12" }}>
              <b>Ask them:</b> {note.ask}
            </span>
          )}
        </span>
      )}
    </span>
  );
}
