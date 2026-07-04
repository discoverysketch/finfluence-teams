import { NextResponse } from "next/server";
import { fetchFinancials } from "@/lib/edgar";

// SEC EDGAR proxy for the Challenge. Logic lives in lib/edgar.ts (shared with the
// entity-facts cache).
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim().toUpperCase();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });
  try {
    const d = await fetchFinancials(ticker);
    if (d && (d.revenue != null || d.totalAssets != null)) return NextResponse.json(d);
  } catch {
    /* fall through */
  }
  return NextResponse.json({ error: `No data found for ${ticker} (not a US filer on EDGAR).` });
}
