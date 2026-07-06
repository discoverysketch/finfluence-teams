import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { fetchPrices } from "@/lib/stock";

// Weekly stock price series (~2y). Fetch logic lives in lib/stock.ts (shared with
// the Plan Export page).
export async function GET(request: Request) {
  const ticker = (new URL(request.url).searchParams.get("ticker") || "").trim();
  if (!ticker) return NextResponse.json({ error: "Missing ticker" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const series = await fetchPrices(ticker);
  if (!series) return NextResponse.json({ error: "No price data" }, { status: 502 });
  return NextResponse.json(series);
}
