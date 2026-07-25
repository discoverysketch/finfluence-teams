// "When was this last researched?" — one shared formatter so every research
// surface reads the same way.
//
// Staleness is per-source, not one global number: a job posting goes cold in
// weeks, while a DEF 14A proxy or the EIA-860 fleet inventory is only published
// once a year and is perfectly current at 11 months old. Flagging those as
// stale would nag reps into re-running research that cannot have changed.
export type Freshness = { label: string; ago: string; stale: boolean };

export const STALE_DAYS = {
  hiring: 30,      // postings turn over monthly
  priorities: 120, // earnings-call cadence — roughly one quarter plus slack
  persona: 240,    // people move, but not often
  decision: 365,   // org structure is slow-moving
  stack: 180,      // systems estates change slowly; the tells (postings) less so
  comp: 400,       // annual proxy — only stale once the next one is filed
  fleet: 400,      // annual EIA-860 inventory
  muni: 400,       // annual CAFR / official statement
  profile: 240,
} as const;

export function researchedAgo(iso: string | null | undefined, staleAfterDays?: number): Freshness | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!isFinite(t)) return null;
  const days = Math.floor((Date.now() - t) / 86400000);
  const ago =
    days <= 0 ? "today"
      : days === 1 ? "yesterday"
        : days < 30 ? `${days} days ago`
          : days < 60 ? "last month"
            : days < 365 ? `${Math.round(days / 30)} months ago`
              : days < 730 ? "over a year ago"
                : `${Math.floor(days / 365)} years ago`;
  return {
    ago,
    label: `Researched ${ago}`,
    stale: staleAfterDays != null && days > staleAfterDays,
  };
}

// Exact date for print/hover, where "3 months ago" isn't specific enough.
export const researchedOn = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;
