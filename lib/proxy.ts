// Deterministic DEF 14A (proxy statement) retrieval from SEC EDGAR.
//
// Why this exists: letting a model web-search for the proxy produced
// INCONSISTENT results across accounts — different mirrors (stocktitan vs
// sec.gov) and even different filing years for the same company, plus ~1-2M
// input tokens per lookup because the whole document lands in context and is
// re-billed on every turn of the agentic loop.
//
// DEF 14A is a standardized form, so the filing is addressable: submissions
// index -> newest DEF 14A -> primary document -> slice the Compensation
// Discussion & Analysis section. Every account then goes through the SAME
// source, the SAME section, and the SAME extraction path, and only a small
// targeted slice is ever sent to the model.
/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = { "User-Agent": "AccountFluency dan.wain1@gmail.com", "Accept-Encoding": "gzip, deflate" };

export type ProxyDoc = {
  url: string;          // canonical sec.gov URL — always, never a mirror
  filed: string;        // filing date, so the UI can state which proxy this is
  fiscalYear: string | null;
  section: string;      // the CD&A / incentive-metrics slice
  chars: number;
};

const clean = (html: string) =>
  html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8212;|&mdash;/g, "—")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

// Terms that mark the pay-for-performance machinery. Used to find the real
// CD&A body (a table of contents mentions the heading but has none of these).
const METRIC_TERMS = [
  "incentive plan", "performance metric", "weighting", "weighted", "payout",
  "cost per customer", "return on equity", "earnings per share", "o&m",
  "target award", "annual incentive", "long-term incentive", "performance goal",
  // Headcount usually lives in the 10-K, but proxies often state it in the
  // human-capital section — catching it here costs nothing extra.
  "full-time employees", "number of employees", "employees as of", "human capital",
];

// Pull windows around metric language so the slice is dense with the table we
// actually want, instead of a fixed prefix that may stop before it.
function metricSlice(text: string, budget = 40000): string {
  const lower = text.toLowerCase();
  const hits: number[] = [];
  for (const t of METRIC_TERMS) {
    let i = lower.indexOf(t);
    while (i !== -1 && hits.length < 400) { hits.push(i); i = lower.indexOf(t, i + t.length); }
  }
  if (!hits.length) return text.slice(0, budget);
  hits.sort((a, b) => a - b);
  // Merge nearby hits into windows, then take them in order until the budget runs out.
  const W = 2500;
  const windows: [number, number][] = [];
  for (const h of hits) {
    const s = Math.max(0, h - W / 2), e = Math.min(text.length, h + W);
    const last = windows[windows.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else windows.push([s, e]);
  }
  // Prefer the densest region of the document (the CD&A), not scattered TOC mentions.
  windows.sort((a, b) => b[1] - b[0] - (a[1] - a[0]));
  const picked = windows.slice(0, 40).sort((a, b) => a[0] - b[0]);
  let out = "";
  for (const [s, e] of picked) {
    if (out.length >= budget) break;
    out += (out ? "\n…\n" : "") + text.slice(s, Math.min(e, s + (budget - out.length)));
  }
  return out;
}

export async function fetchProxy(cik: string): Promise<ProxyDoc | null> {
  const pad = String(cik).padStart(10, "0");
  const r = await fetch(`https://data.sec.gov/submissions/CIK${pad}.json`, { headers: UA });
  if (!r.ok) return null;
  const j: any = await r.json();
  const rec = j?.filings?.recent;
  if (!rec?.form) return null;

  // Newest DEF 14A (the definitive proxy). DEFA14A = additional materials, skip.
  let idx = -1;
  for (let i = 0; i < rec.form.length; i++) {
    if (String(rec.form[i]).toUpperCase() === "DEF 14A") { idx = i; break; }
  }
  if (idx < 0) return null;

  const acc = String(rec.accessionNumber[idx]);
  const nodash = acc.replace(/-/g, "");
  const filed = String(rec.filingDate?.[idx] ?? "");
  const primary = String(rec.primaryDocument?.[idx] ?? "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${nodash}`;
  const url = primary ? `${base}/${primary}` : `${base}/${acc}-index.htm`;

  const doc = await fetch(url, { headers: UA });
  if (!doc.ok) return null;
  const text = clean(await doc.text());
  if (text.length < 2000) return null;

  return {
    url, filed,
    fiscalYear: String(rec.reportDate?.[idx] ?? "").slice(0, 4) || null,
    section: metricSlice(text),
    chars: text.length,
  };
}
