"use client";
import { useMemo, useState } from "react";
import Link from "next/link";

// State tile-grid map (NPR-style): geography without shipping geometry.
// Squares darken with account count and carry the best data-tier's color as an
// underline; tap a state for its account list.
export type MapItem = { accountId: string; name: string; ticker: string | null; tier: string | null; stage: string | null; state: string | null; mine?: boolean };

const GRID: Record<string, [number, number]> = {
  AK: [0, 0], ME: [0, 10],
  VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], IL: [2, 5], WI: [2, 6], MI: [2, 7], NY: [2, 8], CT: [2, 9], MA: [2, 10],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IN: [3, 5], OH: [3, 6], PA: [3, 7], NJ: [3, 8], RI: [3, 9],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};
const TIER_COLOR: Record<string, string> = { A: "#1B7A47", B: "#0572CE", C: "#9A6700", D: "#8A7E6E" };
const bestTier = (items: MapItem[]) => ["A", "B", "C", "D"].find((t) => items.some((i) => i.tier === t)) ?? null;

export default function MapView({ items }: { items: MapItem[] }) {
  const [sel, setSel] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "mine">("all");
  const visible = useMemo(() => items.filter((i) => scope === "all" || i.mine), [items, scope]);
  const byState = useMemo(() => {
    const m: Record<string, MapItem[]> = {};
    for (const i of visible) if (i.state && GRID[i.state.toUpperCase()]) (m[i.state.toUpperCase()] ??= []).push(i);
    return m;
  }, [visible]);
  const unplaced = visible.filter((i) => !i.state || !GRID[i.state.toUpperCase()]);
  const maxCount = Math.max(1, ...Object.values(byState).map((v) => v.length));

  const selected = sel ? byState[sel] ?? [] : [];

  return (
    <div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        <button className="mini" onClick={() => { setScope("all"); setSel(null); }} style={{ fontWeight: 700, background: scope === "all" ? "var(--cream2)" : "#fff" }}>All</button>
        <button className="mini" onClick={() => { setScope("mine"); setSel(null); }} style={{ fontWeight: 700, background: scope === "mine" ? "var(--cream2)" : "#fff" }}>Mine</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(11, 1fr)", gap: 4, maxWidth: 560 }}>
        {Array.from({ length: 8 }).flatMap((_, r) =>
          Array.from({ length: 11 }).map((_, c) => {
            const st = Object.keys(GRID).find((k) => GRID[k][0] === r && GRID[k][1] === c);
            if (!st) return <div key={`${r}-${c}`} />;
            const here = byState[st] ?? [];
            const n = here.length;
            const active = sel === st;
            const alpha = n ? 0.18 + 0.62 * (n / maxCount) : 0;
            const tier = bestTier(here);
            return (
              <button key={st} onClick={() => setSel(active ? null : n ? st : null)}
                aria-label={`${st}: ${n} account${n === 1 ? "" : "s"}`}
                style={{
                  aspectRatio: "1", border: active ? "2px solid var(--red)" : "1px solid #E4DCCB", borderRadius: 7,
                  background: n ? `rgba(178,58,46,${alpha.toFixed(2)})` : "#FBF8F1",
                  cursor: n ? "pointer" : "default", position: "relative", padding: 0,
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 1,
                }}>
                <span style={{ fontSize: 10.5, fontWeight: 800, color: n && alpha > 0.5 ? "#fff" : "var(--ink2)" }}>{st}</span>
                {n > 0 && <span style={{ fontSize: 10, fontWeight: 800, color: n && alpha > 0.5 ? "#fff" : "var(--ink)" }}>{n}</span>}
                {tier && <span style={{ position: "absolute", bottom: 2, left: "20%", right: "20%", height: 3, borderRadius: 2, background: TIER_COLOR[tier] }} />}
              </button>
            );
          })
        )}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "10px 0 4px" }}>
        {Object.entries(TIER_COLOR).map(([t, c]) => (
          <span key={t} style={{ fontSize: 11, color: "var(--ink2)", fontWeight: 600, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 14, height: 3, borderRadius: 2, background: c, display: "inline-block" }} /> Tier {t}
          </span>
        ))}
        <span style={{ fontSize: 11, color: "var(--muted)" }}>Darker = more accounts · underline = best tier in state</span>
      </div>

      {sel && selected.length > 0 && (
        <>
          <div className="secttl" style={{ fontSize: 11, fontWeight: 700, color: "#8A7E6E", textTransform: "uppercase", letterSpacing: ".6px", margin: "14px 0 8px" }}>
            {sel} · {selected.length} account{selected.length === 1 ? "" : "s"}
          </div>
          {selected.slice().sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" })).map((a) => (
            <Link key={a.accountId} href={`/territory/account/${a.accountId}`} style={{ color: "inherit", display: "block" }}>
              <div className="card" style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6, padding: "11px 14px" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{a.name}{a.ticker ? <span style={{ color: "var(--muted)", fontWeight: 600 }}> · {a.ticker}</span> : null}</div>
                  {a.stage && <div style={{ fontSize: 11.5, color: "var(--blue)", fontWeight: 700, marginTop: 1 }}>{a.stage.replace("_", " ")}</div>}
                </div>
                {a.tier && <span style={{ background: TIER_COLOR[a.tier] ?? "#8A7E6E", color: "#fff", fontSize: 10, fontWeight: 700, borderRadius: 4, padding: "2px 6px" }}>Tier {a.tier}</span>}
                <span style={{ fontSize: 16, color: "#8A7E6E" }}>›</span>
              </div>
            </Link>
          ))}
        </>
      )}

      {unplaced.length > 0 && (
        <p style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 12 }}>
          No HQ state on file: {unplaced.map((u) => u.name).join(", ")}
        </p>
      )}
    </div>
  );
}
