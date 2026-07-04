import { NextResponse } from "next/server";

// SEC EDGAR proxy — official, free, every US filer. Ported from the single-file app,
// including the "most-recent-period across all concepts" picker fix.
/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = { "User-Agent": "FinFluency dan.wain1@gmail.com", "Accept-Encoding": "gzip, deflate" };
let TICKERS: any = null;

export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  try {
    const edgar = await fromEdgar(ticker);
    if (edgar && (edgar.revenue != null || edgar.totalAssets != null)) return NextResponse.json(edgar);
  } catch {
    /* fall through */
  }
  return NextResponse.json({ error: `No data found for ${ticker} (not a US filer on EDGAR).` });
}

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

async function fromEdgar(ticker: string) {
  const found = await getCik(ticker);
  if (!found) return null;
  const r = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${found.cik}.json`, { headers: UA });
  if (!r.ok) return null;
  const facts: any = await r.json();

  const usd = (c: string) => facts.facts?.["us-gaap"]?.[c]?.units?.USD || null;
  const days = (s: string, e: string) => Math.round((+new Date(e) - +new Date(s)) / 86400000);
  const sortRows = (a: any, b: any) =>
    a.end < b.end ? 1 : a.end > b.end ? -1 : a.filed < b.filed ? 1 : a.filed > b.filed ? -1 : a._ci - b._ci;

  const pickInstant = (concepts: string[]) => {
    const rows: any[] = [];
    concepts.forEach((c, ci) => { const arr = usd(c); if (arr) for (const x of arr) if (x.form === "10-Q" || x.form === "10-K") rows.push({ ...x, _ci: ci }); });
    if (!rows.length) return null;
    rows.sort(sortRows);
    return { val: rows[0].val, end: rows[0].end };
  };
  const pickDuration = (concepts: string[]) => {
    const all: any[] = [];
    concepts.forEach((c, ci) => { const arr = usd(c); if (arr) for (const x of arr) if (x.start && x.end && (x.form === "10-Q" || x.form === "10-K")) all.push({ ...x, _ci: ci }); });
    if (!all.length) return null;
    const std = all.filter((x) => { const d = days(x.start, x.end); return (d >= 80 && d <= 100) || (d >= 350 && d <= 380); });
    const pool = std.length ? std : all;
    pool.sort(sortRows);
    const t = pool[0];
    return { val: t.val, end: t.end, fy: t.fy, fp: t.fp, days: days(t.start, t.end) };
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

  const data: any = {
    company: found.title, period,
    revenue: M(rev?.val), cogs: M(cogs?.val), operatingIncome: M(opInc?.val), netIncome: M(ni?.val), interestExpense: M(intexp?.val),
    totalAssets: M(assets?.val), totalLiabilities: M(liab?.val), totalEquity: M(equity?.val),
    cash: M(cash?.val), currentAssets: M(ca?.val), currentLiabilities: M(cl?.val),
    totalDebt: M(debt), operatingCashFlow: M(cfo?.val),
    capex: capex ? -Math.abs(M(capex.val)!) : undefined,
  };
  Object.keys(data).forEach((k) => data[k] === undefined && delete data[k]);
  return data;
}
