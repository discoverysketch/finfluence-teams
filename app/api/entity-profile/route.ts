import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Web search + two model calls can run 40–140s; give the function room.
export const maxDuration = 300;

// Tier D: Claude web-researches a sourced profile for a private / non-SEC company
// (co-op, muni, IPP, retailer). Returns a DRAFT — the rep reviews before saving.
/* eslint-disable @typescript-eslint/no-explicit-any */
const PROFILE_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    canonical_name: { type: "string" },
    entity_type: { type: "string", enum: ["iou", "ipp", "coop", "muni", "retailer", "other"] },
    hq_state: { type: "string" },
    ownership: { type: "string" },
    est_size: { type: "string" },
    segment: { type: "string" },
    summary: { type: "string" },
    sources: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, url: { type: "string" } }, required: ["title", "url"] } },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
  },
  required: ["canonical_name", "entity_type", "hq_state", "ownership", "est_size", "segment", "summary", "sources", "confidence"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { name, hint } = await request.json().catch(() => ({}));
  const q = String(name || "").trim();
  if (q.length < 2) return NextResponse.json({ error: "Enter a company name." }, { status: 400 });

  const client = new Anthropic();
  try {
    // 1) Web research. Sonnet 5 (same web_search tool) is ~6x faster than Opus here
    //    — web search on Opus took ~200s; Sonnet lands ~35s. Cap searches for latency.
    const research = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 } as any],
      messages: [{
        role: "user",
        content:
          `Research the company "${q}"${hint ? ` (context: ${hint})` : ""}. It is likely a US utility or energy company that is NOT an SEC filer — a rural electric cooperative, municipal utility, private independent power producer (IPP), or energy retailer. ` +
          `Find: full/legal name; type (investor-owned utility, cooperative, municipal, IPP, retailer, or other); headquarters state; ownership or parent; approximate size (customers served, annual revenue, or generating capacity MW — whatever is available); primary business segment; and one or two recent notable items (rate case, major capital project, M&A). ` +
          `Keep it to a tight paragraph and cite specific source URLs. If you can't find reliable information, say so plainly rather than guessing.`,
      }],
    });
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "No research came back — try adding a state or parent-company hint." }, { status: 502 });

    // 2) Structure the notes into a profile (no web tool here, so we can constrain the format).
    const extract = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1500,
      output_config: { format: { type: "json_schema", schema: PROFILE_SCHEMA } } as any,
      system:
        "Extract a structured company profile from the research notes. Use ONLY what the notes support — if a field is unknown, use an empty string (and an empty sources array if none). " +
        "entity_type: investor-owned=iou, cooperative=coop, municipal=muni, independent power producer=ipp, retailer=retailer, else other. " +
        "confidence reflects how well-sourced the notes are. Pull real source URLs from the notes into sources.",
      messages: [{ role: "user", content: `Company searched: ${q}\n\nResearch notes:\n${notes}` }],
    });
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const profile = JSON.parse(text);
    if (!profile.canonical_name) profile.canonical_name = q;
    return NextResponse.json({ profile });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Research failed — ${msg}` }, { status: 502 });
  }
}
