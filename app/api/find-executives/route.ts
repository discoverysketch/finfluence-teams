import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Executive finder: web-researches an account's leadership team (public info —
// company leadership pages, press releases) and returns a REVIEWABLE list with
// source URLs. Nothing saves until the rep approves. Names/titles only — no
// scraped personal contact details.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */
const ROLES = ["economic_buyer", "champion", "exec_sponsor", "influencer", "end_user", "blocker", ""] as const;
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    executives: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          suggested_role: { type: "string", enum: [...ROLES] },
          source_url: { type: "string" },
        },
        required: ["name", "title", "suggested_role", "source_url"],
      },
    },
  },
  required: ["executives"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId } = await request.json().catch(() => ({}));
  if (!accountId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  // RLS scopes this read — resolves only for accounts in the caller's tenant.
  const { data: acct } = await supabase.from("accounts")
    .select("id, entity:entities(canonical_name, hq_state)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    const research = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 8000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 2 } as any],
      messages: [{
        role: "user",
        content:
          `Find the CURRENT senior leadership of ${ent.canonical_name}${ent.hq_state ? ` (${ent.hq_state})` : ""}, a US utility/energy company. ` +
          `STRICT search budget: ONE query like "${ent.canonical_name} leadership team executives CFO", at most one follow-up. ` +
          `Wanted: CEO, CFO, and finance/operations/technology leaders relevant to an enterprise-software sale (CIO/CTO, VP Finance, Treasurer, COO, VP Supply Chain, chief customer/digital officers). ` +
          `For each: full name, exact title, and the source URL from your results (prefer the company's own leadership page or an official press release). ` +
          `ONLY people you can cite with a URL from your results; skip stale or uncertain entries and say if leadership info couldn't be found. Compact list.`,
      }],
    });
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Research came back empty — try again, or add people manually." }, { status: 502 });

    const extract = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 3000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "Extract the executives from the research notes. ONLY people with a source URL in the notes — drop the rest. " +
        "suggested_role (deal-role guess a rep can edit): CFO/Treasurer/VP Finance -> economic_buyer; CEO/President -> exec_sponsor; " +
        "CIO/CTO/COO/VP-level operators -> influencer; otherwise \"\". No duplicates; dedupe people listed twice.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nResearch notes:\n${notes.slice(0, 16000)}` }],
    });
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const executives = (JSON.parse(text).executives ?? []).filter((e: any) => e.name && /^https?:\/\//.test(e.source_url)).slice(0, 12);
    if (!executives.length) return NextResponse.json({ error: "No citable leadership info found — this one may need manual entry." }, { status: 502 });
    return NextResponse.json({ executives });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Executive search failed — ${msg}` }, { status: 502 });
  }
}
