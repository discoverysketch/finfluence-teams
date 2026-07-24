import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Executive persona brief: public background on a named exec at the account —
// role, tenure, career, focus areas, a public quote if any. Public sources
// only (company leadership pages, press, earnings calls); no scraped personal
// contact details. Saved on the contact so the whole team sees it.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    headline: { type: "string" },
    background: { type: "string" },
    priorities: { type: "array", items: { type: "string" } },
    quote: { type: "string" },
    talk_to_them: { type: "string" },
    source: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["headline", "background", "priorities", "quote", "talk_to_them", "source", "confidence"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { contactId } = await request.json().catch(() => ({}));
  if (!contactId) return NextResponse.json({ error: "Missing person" }, { status: 400 });
  // RLS scopes this to the caller's tenant; join up to the account's company.
  const { data: c } = await supabase.from("contacts")
    .select("id, name, title, account:accounts(entity:entities(canonical_name))").eq("id", contactId).maybeSingle();
  if (!c) return NextResponse.json({ error: "Person not found" }, { status: 404 });
  const company = (c as any).account?.entity?.canonical_name || "";

  const client = new Anthropic();
  try {
    const research = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 7000,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 2 } as any,
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 } as any,
      ],
      messages: [{
        role: "user",
        content:
          `Research ${c.name}${c.title ? `, ${c.title}` : ""}${company ? ` at ${company}` : ""} — a US utility executive — from PUBLIC sources only (company leadership page, press releases, earnings calls, reputable profiles). ` +
          `Wanted: their role and remit, how long they've been there / prior background, the things they publicly focus on or have championed, and one short DIRECT public quote if you find one (with where it's from). ` +
          `Budget: ~2 searches + 2 fetches. Do NOT collect personal contact details (email/phone/home). Report only what you can cite; if the person is hard to find, say so.`,
      }],
    }));
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Nothing public found — this person may be low-profile." }, { status: 502 });

    const extract = await withRetry(() => client.messages.create({
      model: "claude-opus-4-8", max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "Build a concise persona brief from the notes. Use ONLY what's in the notes — never invent a quote, date, or claim. " +
        "headline = one line on who they are and why they matter to the deal. background = 1-2 sentences (role, tenure, prior career). " +
        "priorities = 2-4 short bullets on what they focus on / care about. quote = a real direct quote from the notes, or \"\". " +
        "talk_to_them = one line of advice for a seller on how to engage this person. source = best URL. confidence reflects the evidence.",
      messages: [{ role: "user", content: `Person: ${c.name} (${c.title || "?"}) at ${company}\n\nNotes:\n${notes.slice(0, 12000)}` }],
    }));
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const persona = JSON.parse(text);
    await supabase.from("contacts").update({ persona_json: persona }).eq("id", contactId);
    return NextResponse.json({ persona });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
