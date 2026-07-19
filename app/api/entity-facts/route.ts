import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureEntityFacts } from "@/lib/facts";

// Cached SEC facts for one entity (fetch-or-cache lives in lib/facts.ts).
export async function GET(request: Request) {
  const entityId = new URL(request.url).searchParams.get("entityId") || "";
  if (!entityId) return NextResponse.json({ error: "Missing entityId" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const res = await ensureEntityFacts(supabase, entityId);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({
    company: res.company, period: res.period, source_url: res.source_url,
    asOf: res.asOf, annualLabel: res.annualLabel,
    facts: Object.entries(res.facts).map(([key, value]) => ({ key, value })),
    eia: res.eia,
  });
}
