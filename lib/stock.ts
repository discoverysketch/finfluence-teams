// Weekly share-price series (~2y) from Yahoo Finance's public chart endpoint.
// Shared by /api/stock (book expander) and the Plan Export page (server-side).
/* eslint-disable @typescript-eslint/no-explicit-any */
export type PricePoint = { d: string; c: number };
export type PriceSeries = { points: PricePoint[]; price: number; currency: string; asOf: string };

export async function fetchPrices(ticker: string): Promise<PriceSeries | null> {
  const sym = ticker.replace(/\./g, "-").toUpperCase();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1wk`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return null;
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return null;
    const ts: number[] = res.timestamp || [];
    const close: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
    const points = ts.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: close[i] }))
      .filter((p) => p.c != null).map((p) => ({ d: p.d, c: Math.round((p.c as number) * 100) / 100 }));
    if (!points.length) return null;
    const meta = res.meta || {};
    return { points, price: meta.regularMarketPrice ?? points[points.length - 1].c, currency: meta.currency || "USD", asOf: points[points.length - 1].d };
  } catch {
    return null;
  }
}
