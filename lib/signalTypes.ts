// Buying-signal classification (SPEC 7c). 8-K item codes are the real-time news
// wire of public companies; we only surface the sales-relevant ones — pure
// Reg-FD/exhibit filings are noise. Shared by the cron watcher and the feed UI.
export type SignalKind = "earnings" | "exec" | "ma" | "debt" | "risk" | "agreement";

export type Signal = { kind: SignalKind; label: string; icon: string };

// Priority-ordered: the first matching item code names the event.
const EIGHT_K: [string, Signal][] = [
  ["1.03", { kind: "risk", label: "Bankruptcy / restructuring", icon: "⚠️" }],
  ["5.01", { kind: "ma", label: "Change in control", icon: "🤝" }],
  ["2.01", { kind: "ma", label: "Acquisition or divestiture completed", icon: "🤝" }],
  ["5.02", { kind: "exec", label: "Executive change", icon: "🧑‍💼" }],
  ["2.03", { kind: "debt", label: "New debt / financing", icon: "💵" }],
  ["1.01", { kind: "agreement", label: "Material agreement signed", icon: "📝" }],
  ["2.02", { kind: "earnings", label: "Earnings released", icon: "📊" }],
];

export function classifyFiling(form: string, items?: string | null): Signal | null {
  if (form === "10-K") return { kind: "earnings", label: "Annual report (10-K) filed", icon: "📊" };
  if (form === "10-Q") return { kind: "earnings", label: "Quarterly report (10-Q) filed", icon: "📊" };
  if (form === "8-K" || form === "8-K/A") {
    const codes = String(items || "");
    for (const [code, sig] of EIGHT_K) if (codes.includes(code)) return sig;
    return null; // 7.01/8.01/9.01-only — noise
  }
  return null;
}

// One-line "so what" per signal type — static, no LLM cost.
export const SUGGESTED_MOVE: Record<SignalKind, string> = {
  earnings: "Fresh numbers — take the Pulse before your next conversation.",
  exec: "A decision-maker may have changed — refresh the org chart and reintroduce value early, before vendors pile in.",
  ma: "Integrations mean systems consolidation — prime moment for an ERP/EPM conversation.",
  debt: "New financing usually funds the capital program — opener for a capex-efficiency conversation.",
  risk: "Handle with care — understand the situation before any outreach.",
  agreement: "Something big was signed — worth 10 minutes to understand what changed.",
};
