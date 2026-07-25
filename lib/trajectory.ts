// What shape is this company in? A read of the financials, computed — not
// asked of a model — so it costs nothing, never drifts, and every account is
// judged by exactly the same yardstick.
//
// Replaces deal stage / deal value on the account: this is a research tool on
// public data, so what belongs here is what the filings say about the company,
// not a pipeline guess about the opportunity.
import type { FactMap } from "./facts";

export type Trajectory = {
  label: string;
  tone: "growth" | "invest" | "steady" | "strain" | "unknown";
  color: string;
  headline: string;
  drivers: { label: string; value: string; note: string }[];
};

const TONE_COLOR: Record<Trajectory["tone"], string> = {
  growth: "#1B7A47", invest: "#6A3E8E", steady: "#0572CE", strain: "#B23A2E", unknown: "#8A7E6E",
};

const pct = (n: number) => `${n >= 0 ? "" : "-"}${Math.abs(n).toFixed(1)}%`;

// 5-year rate-base CAGR from the FERC history keys, when present. This is the
// single best growth signal for a regulated utility: rate base is what they
// earn a return on, so its growth rate IS the growth story.
function rateBaseCagr(f: FactMap): number | null {
  const ys = Object.keys(f).filter((k) => /^net_utility_plant_\d{4}$/.test(k)).sort();
  if (ys.length < 3) return null;
  const a = f[ys[0]], b = f[ys[ys.length - 1]];
  return a > 0 && b > 0 ? (Math.pow(b / a, 1 / (ys.length - 1)) - 1) * 100 : null;
}

export function assessTrajectory(f: FactMap): Trajectory {
  const drivers: Trajectory["drivers"] = [];
  const rev = f.fy_revenue ?? f.revenue;
  const cfo = f.fy_operatingCashFlow ?? f.operatingCashFlow;
  const capex = Math.abs(f.fy_capex ?? f.capex ?? 0);
  const ni = f.fy_netIncome ?? f.netIncome;
  const assets = f.totalAssets, debt = f.totalDebt;

  const capexIntensity = rev && capex ? (capex / rev) * 100 : null;   // reinvestment rate
  const leverage = assets && debt ? (debt / assets) * 100 : null;
  const cashMargin = rev && cfo ? (cfo / rev) * 100 : null;
  const margin = rev && ni != null ? (ni / rev) * 100 : null;
  const cagr = rateBaseCagr(f);
  const selfFunding = capex && cfo ? (cfo / capex) * 100 : null;      // can ops pay for the build?

  if (cagr != null) drivers.push({ label: "Rate base", value: `${pct(cagr)}/yr`, note: "5-year growth in net utility plant — what they earn a return on" });
  if (capexIntensity != null) drivers.push({ label: "Reinvestment", value: `${Math.round(capexIntensity)}% of revenue`, note: "capital spending against revenue" });
  if (selfFunding != null) drivers.push({ label: "Self-funding", value: `${Math.round(selfFunding)}%`, note: "operating cash flow as a share of capex — under 100% means external funding" });
  if (cashMargin != null) drivers.push({ label: "Cash margin", value: `${Math.round(cashMargin)}%`, note: "operating cash flow per revenue dollar" });
  if (leverage != null) drivers.push({ label: "Leverage", value: `${Math.round(leverage)}% of assets`, note: "total debt against total assets" });

  // Not enough to say anything honest.
  if (rev == null && cagr == null) {
    return { label: "Not enough data", tone: "unknown", color: TONE_COLOR.unknown, headline: "No filed financials for this account yet.", drivers };
  }

  // Order matters: strain is checked first because a company under pressure can
  // still be building heavily, and the pressure is the thing a seller must know.
  const losing = margin != null && margin < 0;
  const stretched = leverage != null && leverage > 60 && selfFunding != null && selfFunding < 70;
  if (losing || stretched) {
    return {
      label: losing ? "Under pressure" : "Stretched balance sheet", tone: "strain", color: TONE_COLOR.strain,
      headline: losing
        ? "Loss-making on the latest filing — cost and efficiency arguments land harder than growth ones."
        : "Heavily levered and outspending operating cash flow — funding cost and capital discipline are live issues.",
      drivers,
    };
  }

  const buildingHard = (capexIntensity != null && capexIntensity > 25) || (cagr != null && cagr >= 8);
  const growing = cagr != null && cagr >= 5;
  if (buildingHard) {
    return {
      label: "Transforming", tone: "invest", color: TONE_COLOR.invest,
      headline: "Spending heavily against its own revenue base — a build cycle, where capital-project and cost control get attention.",
      drivers,
    };
  }
  if (growing) {
    return {
      label: "Growing fast", tone: "growth", color: TONE_COLOR.growth,
      headline: "Rate base compounding well above the sector's low-single-digit norm — growth is the story here.",
      drivers,
    };
  }
  if (cashMargin != null && cashMargin > 25 && (leverage == null || leverage < 55)) {
    return {
      label: "Steady and cash-generative", tone: "steady", color: TONE_COLOR.steady,
      headline: "Converting revenue to cash comfortably with moderate leverage — efficiency gains, not survival, are the pitch.",
      drivers,
    };
  }
  return {
    label: "Steady", tone: "steady", color: TONE_COLOR.steady,
    headline: "No outlier signals in the filed numbers — a conventional regulated profile.",
    drivers,
  };
}
