// Company Challenge quiz engine — ported from the single-file app.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type Fin = {
  company?: string; period?: string; ticker?: string;
  revenue?: number; cogs?: number; operatingIncome?: number; netIncome?: number; interestExpense?: number;
  totalAssets?: number; totalLiabilities?: number; totalEquity?: number; cash?: number;
  currentAssets?: number; currentLiabilities?: number; totalDebt?: number; operatingCashFlow?: number; capex?: number;
};
export type Question = {
  tag: string; concept: string; q: string;
  options: { label: string; ok: boolean }[]; answer: number; ex: string;
};

export const SAMPLE: Fin = {
  company: "Unitil Corporation", ticker: "UTL", period: "FY2024 (sample)",
  revenue: 494.8, cogs: 235.0, operatingIncome: 90.6, netIncome: 47.1, interestExpense: 38.0,
  totalAssets: 1794.5, totalLiabilities: 1282.0, totalEquity: 512.5, cash: 6.3,
  currentAssets: 188.8, currentLiabilities: 228.7, totalDebt: 749.1, operatingCashFlow: 130.0, capex: -175.0,
};

export const cf$ = (n?: number) => (n == null ? "—" : n < 0 ? "(" + Math.abs(n).toLocaleString() + ")" : n.toLocaleString());
const pctF = (v: number) => (v * 100).toFixed(1) + "%";
const xF = (v: number) => v.toFixed(2) + "×";
const cnm = (d: Fin) => (d.company || "the company").split(" ")[0] + "'s";

export const CHTAG: Record<string, string> = { prof: "#0572CE", liq: "#6A3E8E", ret: "#1B7A47", cash: "#006B72", found: "#C74634" };

export const FORMULAS: Record<string, string> = {
  "Gross margin": "Formula: Gross margin = (Revenue − COGS) ÷ Revenue. Core product profitability, before overhead.",
  "Operating margin": "Formula: Operating margin = Operating income (EBIT) ÷ Revenue. Core business, before financing and tax.",
  "Net margin": "Formula: Net margin = Net income ÷ Revenue. What's left of each revenue dollar.",
  "Current ratio": "Formula: Current ratio = Current assets ÷ Current liabilities. Below 1× is normal for capital-heavy utilities.",
  "Leverage": "Formula: Debt-to-equity = Total debt ÷ Total equity. How much debt funds the business vs. owners' capital.",
  "Interest coverage": "Formula: Interest coverage = EBIT ÷ Interest expense. How many times earnings cover the interest bill.",
  "Cash ratio": "Formula: Cash ratio = Cash ÷ Current liabilities. The strictest liquidity test.",
  "Working capital": "Formula: Working capital = Current assets − Current liabilities. Often negative for utilities.",
  "ROE": "Formula: ROE = Net income ÷ Total equity. For a utility, compare to its allowed ROE.",
  "ROA": "Formula: ROA = Net income ÷ Total assets. Low when the asset base is huge.",
  "Asset turnover": "Formula: Asset turnover = Revenue ÷ Total assets. Revenue per dollar of assets.",
  "Self-funding": "Formula: Self-funding = Operating cash flow ÷ |Capex|. Below 1× means debt/equity fills the gap.",
  "Free cash flow": "Formula: Free cash flow = Operating cash flow − Capex.",
  "Capex intensity": "Formula: Capex intensity = |Capex| ÷ Revenue. Share of revenue reinvested in plant.",
  "Cash flow margin": "Formula: CFO margin = Operating cash flow ÷ Revenue — usually higher than net margin (depreciation add-back).",
  "The balance tie": "Rule: Assets = Liabilities + Equity. The balance sheet must always balance.",
  "Statement links": "Link: Net income flows into retained earnings (equity) and starts the cash flow statement.",
};

function mc(correct: number, distract: number[], fmt: (v: number) => string) {
  if (!Number.isFinite(correct)) return null;
  let opts: { v: number; ok: boolean }[] = [{ v: correct, ok: true }];
  distract.forEach((x) => { if (Number.isFinite(x)) opts.push({ v: x, ok: false }); });
  const seen: Record<string, number> = {};
  opts = opts.filter((o) => { const k = fmt(o.v); if (seen[k]) return false; seen[k] = 1; return true; });
  for (let i = opts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [opts[i], opts[j]] = [opts[j], opts[i]]; }
  return { options: opts.map((o) => ({ label: fmt(o.v), ok: o.ok })), answer: opts.findIndex((o) => o.ok) };
}

export function buildQuiz(d: Fin): Question[] {
  const has = (...k: (keyof Fin)[]) => k.every((x) => d[x] != null);
  const n = (v: any) => v as number;
  const G: Record<string, (() => any)[]> = {
    prof: [
      () => has("revenue", "cogs") && n(d.cogs) > 0 && n(d.cogs) < n(d.revenue) && { tag: "Gross margin", concept: "prof", q: `What was ${cnm(d)} gross margin?`, ...mc((n(d.revenue) - n(d.cogs)) / n(d.revenue), [n(d.cogs) / n(d.revenue), (n(d.revenue) - n(d.cogs)) / n(d.cogs) * 0.5, (d.netIncome || n(d.revenue) * 0.1) / n(d.revenue)], pctF), ex: `Gross margin = (Revenue − COGS) ÷ Revenue = (${cf$(d.revenue)} − ${cf$(d.cogs)}) ÷ ${cf$(d.revenue)}.` },
      () => has("operatingIncome", "revenue") && { tag: "Operating margin", concept: "prof", q: `What was ${cnm(d)} operating margin?`, ...mc(n(d.operatingIncome) / n(d.revenue), [n(d.operatingIncome) / n(d.revenue) * 1.6, n(d.operatingIncome) / n(d.revenue) * 0.55, (d.netIncome || 0) / n(d.revenue)], pctF), ex: `Operating margin = Operating income ÷ Revenue = ${cf$(d.operatingIncome)} ÷ ${cf$(d.revenue)}.` },
      () => has("netIncome", "revenue") && { tag: "Net margin", concept: "prof", q: `What was ${cnm(d)} net margin?`, ...mc(n(d.netIncome) / n(d.revenue), [n(d.netIncome) / n(d.revenue) * 1.7, n(d.netIncome) / n(d.revenue) * 0.6, n(d.netIncome) / (d.totalAssets || n(d.revenue) * 5)], pctF), ex: `Net margin = Net income ÷ Revenue = ${cf$(d.netIncome)} ÷ ${cf$(d.revenue)}.` },
    ],
    liq: [
      () => has("currentAssets", "currentLiabilities") && { tag: "Current ratio", concept: "liq", q: `What is the current ratio?`, ...mc(n(d.currentAssets) / n(d.currentLiabilities), [n(d.currentLiabilities) / n(d.currentAssets), n(d.currentAssets) / n(d.currentLiabilities) + 0.6, n(d.currentAssets) / n(d.currentLiabilities) - 0.4], xF), ex: `Current ratio = Current assets ÷ Current liabilities = ${cf$(d.currentAssets)} ÷ ${cf$(d.currentLiabilities)}. Below 1× is normal for utilities.` },
      () => has("totalDebt", "totalEquity") && { tag: "Leverage", concept: "liq", q: `What is the debt-to-equity ratio?`, ...mc(n(d.totalDebt) / n(d.totalEquity), [n(d.totalEquity) / n(d.totalDebt), n(d.totalDebt) / n(d.totalEquity) + 0.7, n(d.totalDebt) / n(d.totalEquity) * 0.5], xF), ex: `Debt-to-equity = Total debt ÷ Equity = ${cf$(d.totalDebt)} ÷ ${cf$(d.totalEquity)}.` },
      () => has("operatingIncome", "interestExpense") && n(d.interestExpense) > 0 && { tag: "Interest coverage", concept: "liq", q: `Interest coverage — EBIT ÷ interest expense?`, ...mc(n(d.operatingIncome) / n(d.interestExpense), [n(d.interestExpense) / n(d.operatingIncome), n(d.operatingIncome) / n(d.interestExpense) + 1.5, n(d.operatingIncome) / n(d.interestExpense) * 0.5], xF), ex: `Interest coverage = EBIT ÷ Interest = ${cf$(d.operatingIncome)} ÷ ${cf$(d.interestExpense)}.` },
      () => has("cash", "currentLiabilities") && { tag: "Cash ratio", concept: "liq", q: `Cash ÷ current liabilities?`, ...mc(n(d.cash) / n(d.currentLiabilities), [n(d.currentLiabilities) / n(d.cash), n(d.cash) / n(d.currentLiabilities) + 0.3, n(d.cash) / n(d.currentLiabilities) * 2], xF), ex: `Cash ratio = Cash ÷ Current liabilities = ${cf$(d.cash)} ÷ ${cf$(d.currentLiabilities)}.` },
      () => has("currentAssets", "currentLiabilities") && { tag: "Working capital", concept: "liq", q: `Is working capital positive or negative?`, options: [{ label: "Positive", ok: n(d.currentAssets) - n(d.currentLiabilities) > 0 }, { label: "Negative", ok: n(d.currentAssets) - n(d.currentLiabilities) <= 0 }], answer: n(d.currentAssets) - n(d.currentLiabilities) > 0 ? 0 : 1, ex: `Working capital = ${cf$(d.currentAssets)} − ${cf$(d.currentLiabilities)} = ${cf$(n(d.currentAssets) - n(d.currentLiabilities))}. Utilities often run negative.` },
    ],
    ret: [
      () => has("revenue", "totalAssets") && { tag: "Asset turnover", concept: "ret", q: `Asset turnover — revenue ÷ total assets?`, ...mc(n(d.revenue) / n(d.totalAssets), [n(d.totalAssets) / n(d.revenue), n(d.revenue) / n(d.totalAssets) + 0.3, n(d.revenue) / n(d.totalAssets) * 2], xF), ex: `Asset turnover = Revenue ÷ Total assets = ${cf$(d.revenue)} ÷ ${cf$(d.totalAssets)}. Low for capital-heavy utilities.` },
      () => has("netIncome", "totalEquity") && { tag: "ROE", concept: "ret", q: `Return on equity (net income ÷ equity)?`, ...mc(n(d.netIncome) / n(d.totalEquity), [n(d.netIncome) / n(d.totalEquity) * 1.8, n(d.netIncome) / (d.totalAssets || n(d.totalEquity) * 3), n(d.netIncome) / n(d.totalEquity) * 0.5], pctF), ex: `ROE = Net income ÷ Equity = ${cf$(d.netIncome)} ÷ ${cf$(d.totalEquity)}. Compare to the allowed ROE.` },
      () => has("netIncome", "totalAssets") && { tag: "ROA", concept: "ret", q: `Return on assets (net income ÷ total assets)?`, ...mc(n(d.netIncome) / n(d.totalAssets), [n(d.netIncome) / n(d.totalAssets) * 2, n(d.netIncome) / (d.totalEquity || n(d.totalAssets) / 3), n(d.netIncome) / n(d.totalAssets) * 0.5], pctF), ex: `ROA = Net income ÷ Total assets = ${cf$(d.netIncome)} ÷ ${cf$(d.totalAssets)}.` },
    ],
    cash: [
      () => has("operatingCashFlow", "capex") && { tag: "Self-funding", concept: "cash", q: `CFO ÷ capex — how much of the build do operations cover?`, ...mc(n(d.operatingCashFlow) / Math.abs(n(d.capex)), [Math.abs(n(d.capex)) / n(d.operatingCashFlow), n(d.operatingCashFlow) / Math.abs(n(d.capex)) + 0.5, n(d.operatingCashFlow) / Math.abs(n(d.capex)) * 0.5], xF), ex: `CFO ÷ capex = ${cf$(d.operatingCashFlow)} ÷ ${cf$(Math.abs(n(d.capex)))}. Below 1× is the classic utility story.` },
      () => has("operatingCashFlow", "capex") && { tag: "Free cash flow", concept: "cash", q: `Is free cash flow (CFO − capex) positive or negative?`, options: [{ label: "Positive", ok: n(d.operatingCashFlow) + n(d.capex) > 0 }, { label: "Negative", ok: n(d.operatingCashFlow) + n(d.capex) <= 0 }], answer: n(d.operatingCashFlow) + n(d.capex) > 0 ? 0 : 1, ex: `FCF = CFO − capex = ${cf$(d.operatingCashFlow)} − ${cf$(Math.abs(n(d.capex)))} = ${cf$(n(d.operatingCashFlow) + n(d.capex))}.` },
      () => has("capex", "revenue") && { tag: "Capex intensity", concept: "cash", q: `Capex as a share of revenue?`, ...mc(Math.abs(n(d.capex)) / n(d.revenue), [n(d.revenue) / Math.abs(n(d.capex)), Math.abs(n(d.capex)) / n(d.revenue) * 0.5, Math.abs(n(d.capex)) / n(d.revenue) * 1.8], pctF), ex: `Capex intensity = |Capex| ÷ Revenue = ${cf$(Math.abs(n(d.capex)))} ÷ ${cf$(d.revenue)}. Utilities run very high.` },
      () => has("operatingCashFlow", "revenue") && { tag: "Cash flow margin", concept: "cash", q: `Operating cash flow margin — CFO ÷ revenue?`, ...mc(n(d.operatingCashFlow) / n(d.revenue), [n(d.revenue) / n(d.operatingCashFlow), n(d.operatingCashFlow) / n(d.revenue) * 1.6, n(d.operatingCashFlow) / n(d.revenue) * 0.5], pctF), ex: `CFO margin = Operating cash flow ÷ Revenue = ${cf$(d.operatingCashFlow)} ÷ ${cf$(d.revenue)}.` },
    ],
    found: [
      () => has("totalAssets", "totalLiabilities", "totalEquity") && { tag: "The balance tie", concept: "found", q: `Do liabilities + equity equal total assets here?`, options: [{ label: "Yes — it balances", ok: Math.abs(n(d.totalAssets) - (n(d.totalLiabilities) + n(d.totalEquity))) <= Math.max(2, n(d.totalAssets) * 0.01) }, { label: "No — it's off", ok: Math.abs(n(d.totalAssets) - (n(d.totalLiabilities) + n(d.totalEquity))) > Math.max(2, n(d.totalAssets) * 0.01) }], answer: Math.abs(n(d.totalAssets) - (n(d.totalLiabilities) + n(d.totalEquity))) <= Math.max(2, n(d.totalAssets) * 0.01) ? 0 : 1, ex: `Assets = Liabilities + Equity. ${cf$(d.totalAssets)} vs ${cf$(d.totalLiabilities)} + ${cf$(d.totalEquity)} = ${cf$(n(d.totalLiabilities) + n(d.totalEquity))}.` },
      () => has("netIncome") && { tag: "Statement links", concept: "found", q: `This period's net income flows into which balance-sheet line?`, options: [{ label: "Retained earnings", ok: true }, { label: "Cash", ok: false }, { label: "Goodwill", ok: false }, { label: "Accounts payable", ok: false }], answer: 0, ex: `Net income increases retained earnings within equity — and starts the cash flow statement.` },
    ],
  };
  const pool: any[] = [];
  Object.values(G).forEach((a) => pool.push(...a));
  const qs = pool.map((fn) => fn()).filter((q: any) => q && Array.isArray(q.options) && q.options.length >= 2 && q.answer >= 0);
  for (let i = qs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [qs[i], qs[j]] = [qs[j], qs[i]]; }
  return qs.slice(0, 5) as Question[];
}
