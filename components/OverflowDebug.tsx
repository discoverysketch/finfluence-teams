"use client";
import { useEffect, useState } from "react";

// Diagnostic: add ?debug=overflow to any page to find what is wider than the
// screen. Needed because the account page is behind auth, so it can't be
// measured from a dev machine — the reported cut-off has to be measured on
// the device that shows it.
type Row = { tag: string; w: number; right: number; txt: string; path: string };

export default function OverflowDebug() {
  const [rows, setRows] = useState<Row[]>([]);
  const [vw, setVw] = useState(0);

  useEffect(() => {
    const scan = () => {
      const width = document.documentElement.clientWidth;
      setVw(width);
      const found: Row[] = [];
      document.querySelectorAll<HTMLElement>("body *").forEach((el) => {
        if (el.closest("#ovf-debug")) return;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) return;
        if (r.right <= width + 1 && r.width <= width + 1) return;
        // Only the outermost offender in a chain — a wide parent makes every
        // child look wide, and the parent is what needs fixing.
        if (el.parentElement) {
          const pr = el.parentElement.getBoundingClientRect();
          if (pr.right > width + 1 || pr.width > width + 1) return;
        }
        const path: string[] = [];
        let n: HTMLElement | null = el;
        for (let i = 0; n && i < 3; i++, n = n.parentElement) {
          path.unshift(n.tagName.toLowerCase() + (n.className && typeof n.className === "string" ? "." + n.className.split(" ")[0] : ""));
        }
        found.push({
          tag: el.tagName.toLowerCase(),
          w: Math.round(r.width), right: Math.round(r.right),
          txt: (el.textContent || "").trim().slice(0, 60),
          path: path.join(" > "),
        });
      });
      setRows(found.slice(0, 12));
    };
    scan();
    const t = setTimeout(scan, 1500);      // after data loads
    const t2 = setTimeout(scan, 4000);     // after charts render
    window.addEventListener("resize", scan);
    return () => { clearTimeout(t); clearTimeout(t2); window.removeEventListener("resize", scan); };
  }, []);

  return (
    <div id="ovf-debug" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 9999, background: "#1B1D26", color: "#fff", padding: "10px 12px", fontSize: 11, maxHeight: "50vh", overflowY: "auto", fontFamily: "ui-monospace, monospace" }}>
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        viewport {vw}px · {rows.length} element{rows.length === 1 ? "" : "s"} too wide
      </div>
      {rows.length === 0 && <div style={{ color: "#8FCf9f" }}>nothing overflows at this width</div>}
      {rows.map((r, i) => (
        <div key={i} style={{ borderTop: "1px solid #333", padding: "5px 0" }}>
          <div style={{ color: "#F0B840", fontWeight: 700 }}>{r.w}px wide · right edge {r.right}</div>
          <div style={{ color: "#9fd3ff" }}>{r.path}</div>
          <div style={{ color: "#ccc" }}>{r.txt}</div>
        </div>
      ))}
    </div>
  );
}
