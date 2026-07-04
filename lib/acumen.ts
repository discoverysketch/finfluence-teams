// Acumen scoring — verified-weighted, per-concept + overall, with playful/professional faces.
export const CONCEPTS: [string, string][] = [
  ["prof", "Profitability"],
  ["liq", "Liquidity & Leverage"],
  ["ret", "Returns"],
  ["cash", "Cash & Capital"],
  ["found", "Foundations"],
];

export type Ev = { concept_tag: string | null; correct: boolean | null };
export type ConceptScore = { key: string; label: string; score: number | null; attempts: number };

// Confidence-dampened accuracy so low volume can't yield 100 (assumes 1 pseudo-wrong).
function scoreFor(correct: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((100 * correct) / (total + 1));
}

export function conceptScores(events: Ev[]): ConceptScore[] {
  return CONCEPTS.map(([key, label]) => {
    const rows = events.filter((e) => e.concept_tag === key);
    const c = rows.filter((e) => e.correct).length;
    return { key, label, score: scoreFor(c, rows.length), attempts: rows.length };
  });
}

// Overall = attempt-weighted average of verified concept scores, plus a small capped
// practice bonus from flashcards mastered (max +10). Verified knowledge dominates.
export function overallAcumen(events: Ev[], masteredCards: number): number {
  const cs = conceptScores(events).filter((c) => c.score != null && c.attempts > 0);
  const weight = cs.reduce((n, c) => n + c.attempts, 0);
  const verified = weight ? cs.reduce((n, c) => n + (c.score as number) * c.attempts, 0) / weight : 0;
  const practiceBonus = Math.min(10, masteredCards * 0.1);
  return Math.round(Math.min(100, verified + practiceBonus));
}

export type Tier = { name: string; color: string };
export function tier(acumen: number): Tier {
  if (acumen >= 90) return { name: "Expert", color: "#6A3E8E" };
  if (acumen >= 75) return { name: "Advanced", color: "#1B7A47" };
  if (acumen >= 50) return { name: "Proficient", color: "#0572CE" };
  if (acumen >= 25) return { name: "Developing", color: "#9A6700" };
  return { name: "Foundational", color: "#8A7E6E" };
}

// Playful face of the same number.
export function level(acumen: number): { level: number; pct: number } {
  return { level: Math.floor(acumen / 10) + 1, pct: (acumen % 10) * 10 };
}

export function heatColor(score: number | null): string {
  if (score == null) return "#EEE9DF";
  if (score >= 75) return "#CDE9D8";
  if (score >= 50) return "#F6E6B8";
  return "#F3CFC7";
}
