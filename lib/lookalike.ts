// Lookalike scoring: turn an entity's cached facts into a small, scale-aware
// feature vector, then rank candidates by weighted distance. Plain math — no
// embeddings (SPEC §7b). Similarity is 0..1 (1 = identical on shared dims).
export type FactMap = Record<string, number>;

type Feats = { size: number | null; customers: number | null; leverage: number | null; capexInt: number | null; cashMargin: number | null; roa: number | null };
const DIMS = ["size", "customers", "leverage", "capexInt", "cashMargin", "roa"] as const;
const WEIGHTS: Record<(typeof DIMS)[number], number> = { size: 1.4, customers: 1.2, leverage: 1.2, capexInt: 1, cashMargin: 1, roa: 0.8 };

// eia_* keys (EIA-861 ops) let munis/co-ops participate: size falls back to EIA
// retail revenue, and customer count is a first-class similarity dimension.
function feats(f: FactMap): Feats {
  const rev = f.revenue ?? f.eia_revenue ?? f.ferc_revenue, assets = f.totalAssets, debt = f.totalDebt, cfo = f.operatingCashFlow, capex = f.capex, ni = f.netIncome;
  const sizeBase = rev && rev > 0 ? rev : assets && assets > 0 ? assets : null;
  return {
    size: sizeBase ? Math.log10(sizeBase) : null,
    customers: f.eia_customers && f.eia_customers > 0 ? Math.log10(f.eia_customers) : null,
    leverage: debt != null && assets ? debt / assets : null,
    capexInt: capex != null && rev ? Math.abs(capex) / rev : null,
    cashMargin: cfo != null && rev ? cfo / rev : null,
    roa: ni != null && assets ? ni / assets : null,
  };
}

export type Candidate<T> = T & { id: string; facts: FactMap };
export type Ranked<T> = Candidate<T> & { similarity: number; sharedDims: number };

export function rankPeers<T>(target: FactMap, candidates: Candidate<T>[]): Ranked<T>[] {
  const tf = feats(target);
  const cf = candidates.map((c) => ({ c, f: feats(c.facts) }));

  // min-max normalize each dimension across target + candidates
  const ranges: Record<string, { min: number; max: number } | null> = {};
  for (const d of DIMS) {
    const vals = [tf[d], ...cf.map((x) => x.f[d])].filter((v): v is number => v != null);
    ranges[d] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  }
  const norm = (d: (typeof DIMS)[number], v: number | null) => {
    const r = ranges[d]; if (!r || v == null) return null;
    return r.max === r.min ? 0.5 : (v - r.min) / (r.max - r.min);
  };

  return cf.map(({ c, f }) => {
    let sum = 0, w = 0, shared = 0;
    for (const d of DIMS) {
      const a = norm(d, tf[d]), b = norm(d, f[d]);
      if (a != null && b != null) { const wt = WEIGHTS[d]; sum += wt * (a - b) ** 2; w += wt; shared++; }
    }
    const dist = w ? Math.sqrt(sum / w) : 1;
    return { ...c, similarity: Math.max(0, 1 - dist), sharedDims: shared };
  }).sort((a, b) => b.similarity - a.similarity);
}
