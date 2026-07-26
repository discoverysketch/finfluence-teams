"use client";
import { useState } from "react";
import { logoSrc, monogram } from "@/lib/logo";

// Company mark for an account. Falls back to a coloured monogram whenever
// there's no trustworthy domain or the logo fails to load, so the header
// always looks deliberate rather than broken.
export default function CompanyLogo({ name, domain, size = 40 }: { name: string; domain: string | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const mono = monogram(name);
  const box: React.CSSProperties = {
    width: size, height: size, borderRadius: 9, flexShrink: 0,
    display: "grid", placeItems: "center", overflow: "hidden",
    border: "1px solid var(--border)", background: "#fff",
  };

  if (!domain || failed) {
    return (
      <div style={{ ...box, background: mono.color, border: "none" }} aria-hidden="true">
        <span style={{ color: "#fff", fontWeight: 800, fontSize: size * 0.4, letterSpacing: "-.02em" }}>{mono.initials}</span>
      </div>
    );
  }
  return (
    <div style={box}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={logoSrc(domain, 128)} alt=""
        width={size - 10} height={size - 10}
        onError={() => setFailed(true)}
        style={{ objectFit: "contain", display: "block" }}
      />
    </div>
  );
}
