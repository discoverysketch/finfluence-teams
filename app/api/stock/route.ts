import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Weekly stock price series (~2y) from Yahoo Finance's public chart endpoint.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const sym = ticker.replace(/\./g, "-").toUpperCase();
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=2y&interval=1wk`, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!r.ok) return NextResponse.json({ error: "No price data" }, { status: 502 });
    const j: any = await r.json();
    const res = j?.chart?.result?.[0];
    if (!res) return NextResponse.json({ error: "No price data" }, { status: 502 });
    const ts: number[] = res.timestamp || [];
    const close: (number | null)[] = res.indicators?.quote?.[0]?.close || [];
    const points = ts.map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: close[i] }))
      .filter((p) => p.c != null).map((p) => ({ d: p.d, c: Math.round((p.c as number) * 100) / 100 }));
    if (!points.length) return NextResponse.json({ error: "No price data" }, { status: 502 });
    const meta = res.meta || {};
    return NextResponse.json({ points, price: meta.regularMarketPrice ?? points[points.length - 1].c, currency: meta.currency || "USD", asOf: points[points.length - 1].d });
  } catch {
    return NextResponse.json({ error: "Price fetch failed" }, { status: 502 });
  }
}
