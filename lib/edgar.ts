// SEC EDGAR proxy — official, free, every US filer. Includes the
// "most-recent-period across all concepts" picker. Shared by the /api/financials
// route (Challenge) and the entity-facts cache (Territory).
/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = { "User-Agent": "AccountFluency dan.wain1@gmail.com", "Accept-Encoding": "gzip, deflate" };
let TICKERS: any = null;

export type FiscalYear = { label: string; revenue?: number; operatingIncome?: number; netIncome?: number; operatingCashFlow?: number; capex?: number };
export type Financials = {
  company: string; cik: string; period: string; periodEnd?: string;
  revenue?: number; cogs?: number; operatingIncome?: number; netIncome?: number; interestExpense?: number;
  totalAssets?: number; totalLiabilities?: number; totalEquity?: number;
  cash?: number; currentAssets?: number; currentLiabilities?: number;
  totalDebt?: number; operatingCashFlow?: number; capex?: number;
  fy?: FiscalYear; // most recent full fiscal year (10-K, ~annual) for flow items
};

async function getCik(ticker: string) {
  if (!TICKERS) {
    const r = await fetch("https://www.sec.gov/files/company_tickers.json", { headers: UA });
    if (!r.ok) throw new Error("ticker map failed");
    TICKERS = await r.json();
  }
  const cand = [ticker, ticker.replace(/\./g, "-"), ticker.replace(/-/g, ".")];
  for (const k in TICKERS) {
    const row = TICKERS[k];
    if (cand.includes(String(row.ticker).toUpperCase())) {
      return { cik: String(row.cik_str).padStart(10, "0"), title: row.title };
    }
  }
  return null;
}

async function loadFacts(arg: string | { cik: string; title: string }): Promise<{ facts: any; found: { cik: string; title: string } } | null> {
  let found: { cik: string; title: string } | null;
  if (typeof arg === "string") found = await getCik(arg.trim().toUpperCase());
  else found = arg?.cik ? { cik: String(arg.cik).padStart(10, "0"), title: arg.title } : null;
  if (!found) return null;
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${found.cik}.json`, { headers: UA });
  if (!r.ok) return null;
  return { facts: await r.json(), found };
}

// Fetch by ticker, or directly by a known 10-digit CIK + name (directory entities).
export async function fetchFinancials(ticker: string): Promise<Financials | null>;
export async function fetchFinancials(opts: { cik: string; title: string }): Promise<Financials | null>;
export async function fetchFinancials(arg: string | { cik: string; title: string }): Promise<Financials | null> {
  const loaded = await loadFacts(arg);
  return loaded ? compute(loaded.facts, loaded.found) : null;
}

// Latest snapshot + the comparable snapshot ~a year earlier (for "what changed"
// quarter-over-quarter diffs). One EDGAR fetch, two computations.
export async function fetchWithPrior(arg: string | { cik: string; title: string }): Promise<{ current: Financials; prior: Financials | null } | null> {
  const loaded = await loadFacts(arg);
  if (!loaded) return null;
  const current = compute(loaded.facts, loaded.found);
  let prior: Financials | null = null;
  if (current.periodEnd) {
    const cutoff = new Date(+new Date(current.periodEnd) - 300 * 86400000).toISOString().slice(0, 10);
    prior = compute(loaded.facts, loaded.found, cutoff);
    if (prior.periodEnd === current.periodEnd) prior = null; // no earlier data
  }
  return { current, prior };
}

// beforeEnd: only consider rows ending on/before this date — yields the
// snapshot as it stood back then (drives the prior side of the diff).
function compute(facts: any, found: { cik: string; title: string }, beforeEnd?: string): Financials {
  const usd = (c: string) => facts.facts?.["us-gaap"]?.[c]?.units?.USD || null;
  const days = (s: string, e: string) => Math.round((+new Date(e) - +new Date(s)) / 86400000);
  const sortRows = (a: any, b: any) =>
    a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : a._ci - b._ci;

  const inWindow = (x: any) => !beforeEnd || x.end <= beforeEnd;
  const pickInstant = (concepts: string[]) => {
    const rows: any[] = [];
    concepts.forEach((c, ci) => { const arr = usd(c); if (arr) for (const x of arr) if ((x.form === "10-Q" || x.form === "10-K") && inWindow(x)) rows.push({ ...x, _ci: ci }); });
    if (!rows.length) return null;
    rows.sort(sortRows);
    return { val: rows[0].val, end: rows[0].end };
  };
  const pickDuration = (concepts: string[]) => {
    const all: any[] = [];
    concepts.forEach((c, ci) => { const arr = usd(c); if (arr) for (const x of arr) if (x.start && x.end && (x.form === "10-Q" || x.form === "10-K") && inWindow(x)) all.push({ ...x, _ci: ci }); });
    if (!all.length) return null;
    const std = all.filter((x) => { const d = days(x.start, x.end); return (d >= 80 && d <= 100) || (d >= 350 && d <= 380); });
    const pool = std.length ? std : all;
    pool.sort(sortRows);
    const t = pool[0];
    return { val: t.val, end: t.end, fy: t.fy, fp: t.fp, days: days(t.start, t.end) };
  };
  // Most recent FULL fiscal year (10-K, ~365-day duration) for flow items.
  const pickAnnual = (concepts: string[]) => {
    const all: any[] = [];
    concepts.forEach((c, ci) => { const arr = usd(c); if (arr) for (const x of arr) if (x.start && x.end && x.form === "10-K" && inWindow(x)) { const d = days(x.start, x.end); if (d >= 350 && d <= 380) all.push({ ...x, _ci: ci }); } });
    if (!all.length) return null;
    all.sort(sortRows);
    return { val: all[0].val, fy: all[0].fy };
  };
  const M = (v: any) => (v == null ? undefined : Math.round((v / 1e6) * 10) / 10);

  const rev = pickDuration(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RegulatedAndUnregulatedOperatingRevenue", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]);
  let cogs = pickDuration(["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"]);
  const opInc = pickDuration(["OperatingIncomeLoss"]);
  const ni = pickDuration(["NetIncomeLoss", "ProfitLoss"]);
  const intexp = pickDuration(["InterestExpense", "InterestAndDebtExpense", "InterestExpenseNonoperating"]);
  const cfo = pickDuration(["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]);
  const capex = pickDuration(["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToAcquireProductiveAssets"]);
  const assets = pickInstant(["Assets"]);
  const liab = pickInstant(["Liabilities"]);
  const equity = pickInstant(["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"]);
  const cash = pickInstant(["CashAndCashEquivalentsAtCarryingValue", "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents"]);
  const ca = pickInstant(["AssetsCurrent"]);
  const cl = pickInstant(["LiabilitiesCurrent"]);
  const ltd = pickInstant(["LongTermDebtNoncurrent", "LongTermDebtAndCapitalLeaseObligations", "LongTermDebt"]);
  const cd = pickInstant(["LongTermDebtCurrent", "LongTermDebtAndCapitalLeaseObligationsCurrent", "DebtCurrent"]);
  const stb = pickInstant(["ShortTermBorrowings", "CommercialPaper", "OtherShortTermBorrowings"]);

  if (cogs && rev && (cogs.val <= 0 || cogs.val >= rev.val || cogs.val < rev.val * 0.2)) cogs = null;

  let debt: number | undefined;
  const dparts = [ltd, cd, stb].filter(Boolean).map((x: any) => x.val);
  if (dparts.length) debt = dparts.reduce((a, b) => a + b, 0);

  const anchor = ni || rev;
  let period = "Latest period";
  if (anchor) {
    const tag = anchor.fp && anchor.fy ? (anchor.fp === "FY" ? `FY${anchor.fy}` : `${anchor.fp} FY${anchor.fy}`) : anchor.end;
    period = anchor.days >= 80 && anchor.days <= 100 ? tag : anchor.days >= 350 ? `FY${anchor.fy || ""}` : `${anchor.days}-day period to ${anchor.end}`;
  }
  period += " · SEC EDGAR";

  // Annual (full fiscal year) flow figures.
  const revA = pickAnnual(["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "RegulatedAndUnregulatedOperatingRevenue", "RevenueFromContractWithCustomerIncludingAssessedTax", "SalesRevenueNet"]);
  const opIncA = pickAnnual(["OperatingIncomeLoss"]);
  const niA = pickAnnual(["NetIncomeLoss", "ProfitLoss"]);
  const cfoA = pickAnnual(["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]);
  const capexA = pickAnnual(["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsForCapitalImprovements", "PaymentsToAcquireProductiveAssets"]);
  const fyNum = (revA || niA || opIncA || cfoA)?.fy;
  const fy = fyNum ? {
    label: `FY${fyNum}`,
    revenue: M(revA?.val), operatingIncome: M(opIncA?.val), netIncome: M(niA?.val),
    operatingCashFlow: M(cfoA?.val), capex: capexA ? -Math.abs(M(capexA.val)!) : undefined,
  } : undefined;
  if (fy) Object.keys(fy).forEach((k) => (fy as any)[k] === undefined && k !== "label" && delete (fy as any)[k]);

  const data: any = {
    company: found.title, cik: found.cik, period, periodEnd: anchor?.end, fy,
    revenue: M(rev?.val), cogs: M(cogs?.val), operatingIncome: M(opInc?.val), netIncome: M(ni?.val), interestExpense: M(intexp?.val),
    totalAssets: M(assets?.val), totalLiabilities: M(liab?.val), totalEquity: M(equity?.val),
    cash: M(cash?.val), currentAssets: M(ca?.val), currentLiabilities: M(cl?.val),
    totalDebt: M(debt), operatingCashFlow: M(cfo?.val),
    capex: capex ? -Math.abs(M(capex.val)!) : undefined,
  };
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  return data as Financials;
}
