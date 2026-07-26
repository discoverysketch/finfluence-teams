// Plain-English definitions for the financial metrics the app shows.
//
// Written for a seller, not an accountant: what the number is, why it matters
// in a utility conversation, and the question it should prompt. This is a
// financial-fluency tool, so the metrics should teach while they're read —
// a rep who can explain CWIP in a meeting is the whole point of the product.
export type MetricNote = { label: string; what: string; why: string; ask?: string };

export const METRIC_NOTES: Record<string, MetricNote> = {
  // ---- SEC / income statement ----
  revenue: {
    label: "Revenue",
    what: "Total money billed to customers over the period, before any costs.",
    why: "Utility revenue moves mostly with approved rates and volumes, not with sales effort — so growth usually means a rate case landed or the customer base grew, not a better quarter.",
  },
  operatingIncome: {
    label: "Operating income",
    what: "Profit from running the utility, before interest and tax.",
    why: "Strips out financing choices, so it shows how the business itself is performing. Regulators effectively set this by approving rates and allowed returns.",
  },
  netIncome: {
    label: "Net income",
    what: "What's left after every cost, including interest and tax.",
    why: "Often the headline metric executive bonuses are tied to, usually as EPS. Check the proxy — if leadership is paid on EPS, cost programmes are how they hit it.",
  },
  operatingCashFlow: {
    label: "Operating cash flow",
    what: "Actual cash the business generated, before capital spending.",
    why: "For a capital-hungry utility this is the number that funds the build. When it doesn't cover capex, the gap is filled with debt or equity — which is a financing cost conversation.",
  },
  capex: {
    label: "Capex",
    what: "Cash spent on plant, poles, wires, meters and generation.",
    why: "The engine of a regulated utility: capex becomes rate base, and rate base earns an allowed return. Heavy capex means capital-project control is a live executive concern.",
    ask: "How much of this year's capital plan is discretionary versus mandated?",
  },
  interestExpense: {
    label: "Interest expense",
    what: "Cost of servicing debt over the period.",
    why: "Rising interest cost squeezes the same earnings regulators allow, which pushes leadership toward cost discipline everywhere else.",
  },
  cogs: {
    label: "Cost of revenue",
    what: "Direct cost of delivering service — largely fuel and purchased power.",
    why: "Mostly passed through to customers via fuel clauses, so it moves revenue and cost together without changing profit much.",
  },

  // ---- SEC / balance sheet ----
  totalAssets: {
    label: "Total assets",
    what: "Everything the company owns, at book value.",
    why: "Utilities are asset-heavy by design — most of this is physical plant, which is what the regulated return is calculated on.",
  },
  totalDebt: {
    label: "Total debt",
    what: "All borrowings — long-term notes, current maturities and short-term borrowings added together.",
    why: "Utilities run high debt deliberately, because regulated cash flows are predictable enough to support it. What matters is the trend and the cost, not the size.",
    ask: "What's the maturity wall over the next two or three years?",
  },
  totalLiabilities: {
    label: "Total liabilities",
    what: "Everything owed, including debt, payables and deferred taxes.",
    why: "Assets minus liabilities is book equity — the base regulators apply the allowed return on equity to.",
  },
  totalEquity: {
    label: "Total equity",
    what: "Shareholders' book value: assets minus liabilities.",
    why: "The denominator in return on equity, the single number most regulated utilities are managed against.",
  },
  cash: { label: "Cash", what: "Cash and equivalents on hand.", why: "Usually thin at a utility — they draw on credit facilities rather than hold cash, so a low balance is normal, not a warning." },

  // ---- FERC Form 1 ----
  net_utility_plant: {
    label: "Net utility plant",
    what: "The book value of poles, wires, substations and generation actually in service, after depreciation.",
    why: "The closest public proxy for RATE BASE — the asset pile a regulator lets them earn a return on. Its growth rate is the utility's real growth story, more than revenue.",
    ask: "What's the rate-base growth target through the current plan?",
  },
  cwip: {
    label: "CWIP — construction work in progress",
    what: "Capital already spent on projects that are NOT yet finished or in service.",
    why: "CWIP usually earns no return until the project is completed and moved into rate base. So a large balance means real money is parked and unearning, and there's pressure to finish on schedule and get it approved in the next rate case. It's the strongest signal of an active build programme.",
    ask: "What are the biggest projects sitting in CWIP, and when do they go into service?",
  },
  om_expense: {
    label: "O&M expense",
    what: "Operations and maintenance — running cost of the system: crews, contractors, materials, support functions. Excludes fuel and capital.",
    why: "The line regulators scrutinise hardest and the one executives are most often paid to reduce, frequently as O&M cost per customer. If a bonus depends on it, efficiency has a budget.",
    ask: "Is O&M per customer a formal target in the current plan?",
  },
  electric_revenue: { label: "Electric operating revenue", what: "Revenue from regulated electric service alone.", why: "Separates the regulated core from gas, transmission or unregulated arms — useful when a holding company mixes several businesses." },

  // ---- EIA-861 operations ----
  customers: { label: "Customers", what: "Retail customer accounts served.", why: "The denominator for every per-customer metric, including the cost-per-customer targets that show up in executive pay." },
  sales_mwh: { label: "Energy delivered", what: "Retail electricity sold, in MWh.", why: "Shows scale and load mix. Flat or falling volumes with rising revenue means rates are doing the work." },
  rev_per_customer: { label: "Revenue per customer", what: "Retail revenue divided by customer count.", why: "A quick read on customer mix — heavily industrial utilities look very different from residential ones." },

  // ---- derived ratios ----
  leverage: { label: "Leverage (debt / assets)", what: "Total debt as a share of total assets.", why: "Utilities typically sit around half. Well above that, and financing cost starts driving decisions." },
  capex_intensity: { label: "Capex / revenue", what: "Capital spending as a share of revenue.", why: "Above about a quarter signals a heavy build cycle — the moment capital-project scheduling and cost control get executive attention." },
  cash_margin: { label: "Cash margin", what: "Operating cash flow per dollar of revenue.", why: "How efficiently revenue converts to cash to fund the build without borrowing." },
  roa: { label: "Return on assets", what: "Net income as a share of total assets.", why: "Low by design at a utility — the return is set by regulators, not the market." },
  self_funding: { label: "Self-funding", what: "Operating cash flow as a share of capex.", why: "Under 100% means the build is partly funded externally, so debt and equity issuance are on the table." },
};

export const noteFor = (key: string): MetricNote | null => METRIC_NOTES[key] ?? null;
