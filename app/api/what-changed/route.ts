import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { fetchWithPrior } from "@/lib/edgar";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// "What changed": when a fresh 10-Q/10-K lands, diff it against the comparable
// period a year ago. The DELTA TABLE is computed deterministically from EDGAR —
// the model only narrates it (headline, meaning, talk track); it cannot invent
// or alter a number.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" },
    changes: { type: "array", items: { type: "string" } },
    talk_track: { type: "string" },
    watch: { type: "string" },
  },
  required: ["headline", "changes", "talk_track", "watch"],
};

const ROWS: [string, string][] = [
  ["revenue", "Revenue"], ["operatingIncome", "Operating income"], ["netIncome", "Net income"],
  ["operatingCashFlow", "Operating cash flow"], ["capex", "Capex"],
  ["totalDebt", "Total debt"], ["cash", "Cash"], ["totalAssets", "Total assets"], ["totalEquity", "Total equity"],
];
const fmtM = (v: number) => (Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : `$${Math.round(v)}M`);

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  if (!ent.cik && !ent.ticker) return NextResponse.json({ error: "No SEC filings for this account." }, { status: 422 });

  let pair: Awaited<ReturnType<typeof fetchWithPrior>> = null;
  try { pair = await fetchWithPrior(ent.cik ? { cik: ent.cik, title: ent.canonical_name } : (ent.ticker as string)); } catch { /* below */ }
  if (!pair?.current) return NextResponse.json({ error: "Couldn't pull SEC data." }, { status: 502 });
  if (!pair.prior) return NextResponse.json({ error: "No comparable prior period on file yet." }, { status: 422 });

  const { current, prior } = pair;
  const delta = ROWS.map(([k, label]) => {
    const cur = (current as any)[k], prev = (prior as any)[k];
    if (cur == null || prev == null) return null;
    const chg = prev !== 0 ? ((cur - prev) / Math.abs(prev)) * 100 : null;
    return { key: k, label, cur, prev, chg: chg != null ? Math.round(chg * 10) / 10 : null };
  }).filter(Boolean) as { key: string; label: string; cur: number; prev: number; chg: number | null }[];
  if (delta.length < 3) return NextResponse.json({ error: "Not enough overlapping figures to compare periods." }, { status: 422 });

  const curLabel = current.period.replace(" · SEC EDGAR", "");
  // EDGAR quirk: year-ago comparatives ride inside the NEW filing and carry its
  // fiscal labels — when labels collide, name the prior period by its end date.
  let prevLabel = prior.period.replace(" · SEC EDGAR", "");
  if (prevLabel === curLabel) prevLabel = `year-ago (to ${prior.periodEnd ?? "prior period"})`;
  const table = delta.map((d) => `${d.label}: ${fmtM(d.prev)} -> ${fmtM(d.cur)}${d.chg != null ? ` (${d.chg >= 0 ? "+" : ""}${d.chg}%)` : ""}`).join("\n");

  const client = new Anthropic();
  try {
    const final = await withRetry(async () => {
      const stream = client.messages.stream({
        model: "claude-opus-4-8", max_tokens: 2500,
        thinking: { type: "adaptive" } as any,
        output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
        system:
          `${ent.canonical_name} just filed. Narrate the year-over-year delta below for an Oracle rep (ERP/EPM/Primavera) selling into this utility. Rules:\n` +
          "- Use ONLY the figures in the delta table; quote them as given. Never invent or recompute numbers beyond simple restatement.\n" +
          "- headline: one sentence — the single biggest change and why a rep cares.\n" +
          "- changes: 3-5 bullets, each naming a figure, its move, and the sales-relevant implication (capital program, funding pressure, cost discipline, liquidity).\n" +
          "- talk_track: 2-3 sentences the rep could say to sound like they read the filing this morning.\n" +
          "- watch: one thing to watch next quarter.\n" +
          "Plain, confident, specific.",
        messages: [{ role: "user", content: `PERIODS: ${prevLabel} -> ${curLabel}\n\nDELTA TABLE:\n${table}` }],
      });
      return stream.finalMessage();
    });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ narrative: JSON.parse(text), delta, curLabel, prevLabel });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't build the comparison — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
