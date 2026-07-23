import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Proof-point harvester: web-researches REAL utility/energy/water customer
// stories for Oracle products and drafts them as cards (same shape as the
// generator, same human-approval flow — nothing auto-publishes). Every story
// must carry its source URL. Admin-only.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */
const CONCEPTS = ["prof", "liq", "ret", "cash", "found"] as const;
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          front: { type: "string" }, concept_tag: { type: "string", enum: [...CONCEPTS] },
          prompt: { type: "string" }, whatItIs: { type: "string" }, whyItMatters: { type: "string" },
          link: { type: "string" }, utility: { type: "string" }, worked: { type: "string" },
        },
        required: ["front", "concept_tag", "prompt", "whatItIs", "whyItMatters", "link", "utility", "worked"],
      },
    },
  },
  required: ["cards"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { topic, count, exclude } = await request.json().catch(() => ({}));
  const n = Math.min(Math.max(Number(count) || 4, 1), 8);
  const focus = String(topic || "").trim() || "Oracle Cloud ERP, EPM, Fusion SCM, Primavera P6, Aconex, and Oracle Energy and Water";
  // Library mode: customers already covered — skip them so re-runs only ADD.
  const excl = (Array.isArray(exclude) ? exclude : []).map((s: unknown) => String(s)).filter(Boolean).slice(0, 80);
  const exclLine = excl.length ? ` DO NOT include stories about these customers (already in our library): ${excl.join("; ")}.` : "";

  const client = new Anthropic();
  try {
    // 1) Live web research (Sonnet — ~6x faster than Opus for web search).
    const research = await client.messages.create({
      model: "claude-sonnet-5", max_tokens: 9000,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 } as any],
      messages: [{
        role: "user",
        content:
          `Find ${n} REAL, citable customer success stories where UTILITY, ENERGY, or WATER companies (IOUs, municipals, co-ops, water districts, grid operators — any country, prefer US) used ${focus}. ` +
          `You have a limited search budget — be efficient: start with ONE broad targeted query (e.g. site:oracle.com/customers utility energy) whose results list several stories at once, then at most 1-2 follow-ups on specific candidates. ` +
          `Prefer oracle.com/customers case studies and official press releases. For each story capture: customer name; which Oracle product(s); what they deployed/replaced; concrete outcomes with numbers where published (cost, close time, project delivery, customers served); and the EXACT source URL from your search results. ` +
          `Only include stories you can cite with a URL that appeared in your search results — skip anything you can't source. Plain compact notes, one story per paragraph.` + exclLine,
      }],
    });
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Research came back empty — try a more specific topic." }, { status: 502 });

    // 2) Structure into draft cards (same shape the editor's review flow expects).
    const extract = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 4000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "Turn each sourced customer story from the notes into ONE flashcard for utility-focused sales reps. Use ONLY facts present in the notes — never invent figures. " +
        "front = 'Customer — product' (e.g. 'Salt River Project — Cloud ERP'). prompt = one-line quiz question about the story. " +
        "whatItIs = what they deployed and why. whyItMatters = the outcomes, with numbers when the notes have them. link = the Oracle products used. " +
        "utility = why this story resonates with a utility CFO. worked = the single best metric or result, ending with the source on its own: 'Source: <url>'. " +
        "concept_tag = the closest finance concept (prof/liq/ret/cash/found). Drop any story whose notes lack a source URL.",
      messages: [{ role: "user", content: `${excl.length ? `Drop any story about these already-covered customers: ${excl.join("; ")}.\n\n` : ""}Research notes:\n\n${notes.slice(0, 20000)}` }],
    });
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const cards = JSON.parse(text).cards ?? [];
    if (!cards.length) return NextResponse.json({ error: "No sourceable stories survived — try a different topic." }, { status: 502 });
    return NextResponse.json({ cards });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Research failed — ${msg}` }, { status: 502 });
  }
}
