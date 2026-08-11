// Partner registry. PowerPlan is the first entry; the shape is deliberately
// general because the next ones (SIs, other ISVs) work the same way.
//
// Nothing here asserts what a partner's software does beyond what the partner
// says publicly, and every claim carries the page it came from. Inventing
// partner capability is the one mistake that would embarrass a rep in front of
// the partner themselves.
import type { FactMap } from "./facts";

export type Partner = {
  key: string;
  name: string;
  site: string;
  kind: "ISV" | "SI";
  tagline: string;
  /** Matches the partner in stored research text. One word and unambiguous. */
  match: RegExp;
  /** Where the line sits, so a rep never positions against a partner. */
  boundary: { oracle: string[]; partner: string[]; together: string };
  /** What makes an account a good joint target, in plain English. */
  fitBasis: string;
  sources: { title: string; url: string }[];
};

export const PARTNERS: Partner[] = [
  {
    key: "powerplan",
    name: "PowerPlan",
    site: "https://powerplan.com/",
    kind: "ISV",
    tagline: "Tax and accounting for asset-intensive businesses — 30+ years in regulated utilities.",
    match: /\bpowerplan\b/i,
    boundary: {
      oracle: [
        "General ledger, payables, receivables and procurement",
        "Project portfolio management (PPM)",
        "Planning and budgeting, consolidation, account reconciliation (EPBCS, FCCS, ARCS)",
        "Enterprise data management (EDMCS)",
      ],
      partner: [
        "Capital project planning and asset accounting",
        "Tax, including tax fixed assets",
        "Lease management",
        "Budgeting for the asset lifecycle",
        "Regulatory compliance reporting",
      ],
      together:
        "PowerPlan joined Oracle's enhanced partner program, and its pre-configured utility asset-accounting and regulatory-compliance workflows are designed to run on top of Oracle Cloud ERP. Finding PowerPlan at an account is a co-sell signal, not a competitive one.",
    },
    fitBasis:
      "A large, growing rate base with heavy construction in flight is the profile PowerPlan is built for: the more capital a regulated utility has under construction, the more asset, tax and regulatory accounting it has to do.",
    sources: [
      { title: "PowerPlan — Utilities", url: "https://powerplan.com/industries/utilities/" },
      { title: "PowerPlan NXT general availability (Feb 2026)", url: "https://www.globenewswire.com/news-release/2026/02/24/3243691/0/en/next-generation-tax-and-accounting-platform-launches-for-asset-intensive-industries.html" },
      { title: "Exelon finance transformation at Oracle Customer Edge Summit 2026", url: "https://powerplan.com/exelons-finance-transformation-success-with-powerplan-to-be-showcased-at-oracle-customer-edge-summit/" },
    ],
  },
];

export const partnerByKey = (k: string) => PARTNERS.find((p) => p.key === k);

// --------------------------------------------------------------- evidence
export type Evidence = { field: string; quote: string; source: string | null };

const FIELD_LABEL: Record<string, string> = {
  hiring_json: "Job postings", stack_json: "What they run today",
  priorities_json: "Leadership priorities", risks_json: "Risk factors",
  profile_json: "Profile",
};

/**
 * Walk stored research JSON for mentions of a partner.
 *
 * Deliberately structural rather than a regex over the stringified blob: the
 * source URL lives on the same object as the text that mentions the partner,
 * and flattening the JSON first loses that pairing — leaving a quote the rep
 * cannot check.
 */
export function findEvidence(blobs: Record<string, unknown>, rx: RegExp, max = 4): Evidence[] {
  const out: Evidence[] = [];

  const walk = (node: unknown, field: string, inheritedSource: string | null) => {
    if (out.length >= max || node == null) return;
    if (typeof node === "string") return;
    if (Array.isArray(node)) { for (const n of node) walk(n, field, inheritedSource); return; }
    if (typeof node !== "object") return;

    const o = node as Record<string, unknown>;
    const source = (typeof o.source === "string" && /^https?:\/\//.test(o.source) ? o.source : null)
      ?? (typeof o.source_url === "string" && /^https?:\/\//.test(o.source_url) ? o.source_url : null)
      ?? inheritedSource;

    for (const [k, v] of Object.entries(o)) {
      if (out.length >= max) return;
      if (typeof v === "string" && rx.test(v)) {
        // Trim to the sentence around the mention so the card shows the claim,
        // not a paragraph of unrelated commentary.
        const i = v.search(rx);
        const start = Math.max(0, v.lastIndexOf(". ", Math.max(0, i - 1)) + 1);
        const endRel = v.indexOf(". ", i);
        const quote = v.slice(start, endRel > -1 ? endRel + 1 : Math.min(v.length, i + 260)).trim();
        if (quote.length > 25 && !out.some((e) => e.quote === quote)) {
          out.push({ field: FIELD_LABEL[field] ?? field, quote: quote.slice(0, 320), source });
        }
      } else if (typeof v === "object") {
        walk(v, field, source);
      }
    }
  };

  for (const [field, blob] of Object.entries(blobs)) walk(blob, field, null);
  // Checkable evidence first. Some of the strongest findings sit in a research
  // summary that carries no URL of its own — Exelon's PowerPlan/Fusion
  // integration is one — so unsourced quotes are ranked below rather than
  // dropped, and the card simply shows no link for them.
  return out.sort((a, b) => (a.source ? 0 : 1) - (b.source ? 0 : 1));
}

// ------------------------------------------------------------------- fit
export type Fit = {
  band: "strong" | "good" | "possible" | "thin";
  label: string;
  score: number;
  drivers: { label: string; value: string }[];
};

const BAND_LABEL: Record<Fit["band"], string> = {
  strong: "Strong joint fit", good: "Good joint fit", possible: "Possible", thin: "Thin",
};
export const FIT_COLOR: Record<Fit["band"], string> = {
  strong: "#1B7A47", good: "#0572CE", possible: "#9A6700", thin: "#8A7E6E",
};

const money = (m: number) => (Math.abs(m) >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${Math.round(m)}M`);

/**
 * Joint-target fit from FERC Form 1 alone — no AI, no new data.
 *
 * This scores how much asset accounting an account has to do, which is what
 * PowerPlan sells into. It is a signal drawn from public financials, NOT a
 * prediction that anyone will buy anything, and the UI says so.
 */
export function assessFit(f: FactMap | null): Fit | null {
  if (!f) return null;
  const years = Object.keys(f).filter((k) => /^net_utility_plant_\d{4}$/.test(k)).sort();
  const plant = f.net_utility_plant ?? (years.length ? f[years[years.length - 1]] : undefined);
  if (!plant || plant <= 0) return null;

  const drivers: { label: string; value: string }[] = [];
  let score = 0;

  // Size of the asset base — the volume of accounting to be done.
  if (plant >= 20000) score += 3;
  else if (plant >= 8000) score += 2;
  else if (plant >= 2000) score += 1;
  drivers.push({ label: "Rate base (net utility plant)", value: money(plant) });

  // Construction in flight. CWIP as a share of plant is the sharpest signal:
  // work in progress is precisely what capital-project accounting handles.
  const cwip = f.cwip;
  if (cwip != null && cwip > 0) {
    const ratio = (cwip / plant) * 100;
    if (ratio >= 12) score += 3;
    else if (ratio >= 7) score += 2;
    else if (ratio >= 3) score += 1;
    drivers.push({ label: "Construction in progress", value: `${money(cwip)} · ${ratio.toFixed(1)}% of plant` });
  }

  // Growth: a rate base compounding fast is adding assets to account for.
  if (years.length >= 3) {
    const a = f[years[0]], b = f[years[years.length - 1]];
    if (a > 0 && b > 0) {
      const cagr = (Math.pow(b / a, 1 / (years.length - 1)) - 1) * 100;
      if (cagr >= 7) score += 2;
      else if (cagr >= 4) score += 1;
      drivers.push({ label: "Rate-base growth", value: `${cagr >= 0 ? "" : "-"}${Math.abs(cagr).toFixed(1)}%/yr over ${years.length - 1}y` });
    }
  }

  const band: Fit["band"] = score >= 7 ? "strong" : score >= 5 ? "good" : score >= 3 ? "possible" : "thin";
  return { band, label: BAND_LABEL[band], score, drivers };
}
