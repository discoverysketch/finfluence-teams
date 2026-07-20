import type { FactMap } from "@/lib/facts";

// Signal-based account tiering from current SEC facts (SPEC §7c, v1 — richer
// growth/rate-case/M&A signals need time-series + FERC ingestion, later).
export type SignalKey = "scale" | "customers" | "capex" | "cwip" | "headroom" | "profit";
export type SignalWeights = Record<SignalKey, number>;
export const DEFAULT_WEIGHTS: SignalWeights = { scale: 1, customers: 1, capex: 1.2, cwip: 1.1, headroom: 0.8, profit: 0.8 };
export const SIGNAL_LABEL: Record<SignalKey, string> = {
  scale: "Scale", customers: "Customer base", capex: "Capex program", cwip: "Construction pipeline", headroom: "Balance-sheet headroom", profit: "Margins",
};
export const SIGNAL_WHY: Record<SignalKey, string> = {
  scale: "large scale", customers: "large customer base", capex: "heavy capex program", cwip: "big construction pipeline", headroom: "balance-sheet headroom", profit: "strong margins",
};
const DIMS: SignalKey[] = ["scale", "customers", "capex", "cwip", "headroom", "profit"];

export type RawSignals = Record<SignalKey, number | null>;
// FactMap may carry eia_* (EIA-861 ops) and ferc_* (FERC Form 1) keys alongside
// SEC figures. Scale falls back to EIA/FERC revenue; the customer-base dim is
// EIA-only; the construction-pipeline dim is CWIP relative to net plant (FERC) —
// the share of the rate base still mid-build.
export function rawSignals(f: FactMap): RawSignals {
  const rev = f.revenue ?? f.eia_revenue ?? f.ferc_revenue, assets = f.totalAssets, debt = f.totalDebt, capex = f.capex, ni = f.netIncome, opInc = f.operatingIncome;
  return {
    scale: rev && rev > 0 ? Math.log10(rev) : assets && assets > 0 ? Math.log10(assets) : null,
    customers: f.eia_customers && f.eia_customers > 0 ? Math.log10(f.eia_customers) : null,
    capex: capex != null && rev ? Math.abs(capex) / rev : null,
    cwip: f.ferc_cwip != null && f.ferc_net_plant ? f.ferc_cwip / f.ferc_net_plant : null,
    headroom: debt != null && assets ? 1 - debt / assets : null,
    profit: opInc != null && rev ? opInc / rev : ni != null && assets ? ni / assets : null,
  };
}

export type Scored<T> = T & { score: number; tier: "A" | "B" | "C"; parts: Record<SignalKey, number | null>; raw: RawSignals };

export function scoreTerritory<T extends { id: string; facts: FactMap }>(items: T[], w: SignalWeights): Scored<T>[] {
  const sig = items.map((it) => ({ it, s: rawSignals(it.facts) }));
  const ranges: Partial<Record<SignalKey, { min: number; max: number }>> = {};
  for (const d of DIMS) {
    const vals = sig.map((x) => x.s[d]).filter((v): v is number => v != null);
    if (vals.length) ranges[d] = { min: Math.min(...vals), max: Math.max(...vals) };
  }
  const norm = (d: SignalKey, v: number | null) => {
    const r = ranges[d]; if (!r || v == null) return null;
    return r.max === r.min ? 0.5 : (v - r.min) / (r.max - r.min);
  };

  const scored = sig.map(({ it, s }) => {
    let sum = 0, wsum = 0;
    const parts = {} as Record<SignalKey, number | null>;
    for (const d of DIMS) {
      const n = norm(d, s[d]); parts[d] = n;
      if (n != null) { sum += w[d] * n; wsum += w[d]; }
    }
    return { ...it, score: wsum ? Math.round((100 * sum) / wsum) : 0, parts, raw: s, tier: "C" as const };
  }).sort((a, b) => b.score - a.score);

  const n = scored.length;
  return scored.map((x, i) => ({ ...x, tier: (i < Math.ceil(n / 3) ? "A" : i < Math.ceil((2 * n) / 3) ? "B" : "C") as "A" | "B" | "C" }));
}

// One-line rationale from the strongest normalized signals.
export function whyLine(parts: Record<SignalKey, number | null>): string {
  const top = DIMS.filter((d) => (parts[d] ?? 0) >= 0.6).sort((a, b) => (parts[b] ?? 0) - (parts[a] ?? 0)).slice(0, 2);
  if (!top.length) return "Balanced profile";
  return top.map((d) => SIGNAL_WHY[d]).join(" + ").replace(/^./, (c) => c.toUpperCase());
}
