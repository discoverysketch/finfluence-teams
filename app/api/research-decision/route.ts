import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Decision-authority research: does this company make its own enterprise-
// software decisions, or does a corporate parent decide? Web-researched with
// sources, reviewed by the rep before saving to the shared directory (service
// role — entities are shared, like entity_facts).
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    locus: { type: "string", enum: ["local", "corporate", "mixed"] },
    parent: { type: "string" },
    note: { type: "string" },
    source_url: { type: "string" },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["locus", "parent", "note", "source_url", "confidence"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId, mode, decision } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing entity" }, { status: 400 });
  // RLS-scoped read proves the caller can see this entity.
  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state, entity_type").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  if (mode === "save") {
    if (!decision?.locus || !["local", "corporate", "mixed"].includes(decision.locus)) {
      return NextResponse.json({ error: "Missing decision" }, { status: 400 });
    }
    const admin = createAdminClient();
    const { error } = await admin.from("entities").update({
      decision_locus: decision.locus,
      decision_note: String(decision.note || "").slice(0, 500) || null,
      decision_source: String(decision.source_url || "").slice(0, 400) || null,
    }).eq("id", entityId);
    if (error) return NextResponse.json({ error: `${error.message} (run migration 0018?)` }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const client = new Anthropic();
  try {
    const research = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 9000,
      tools: [
        { type: "web_search_20260209", name: "web_search", max_uses: 2 } as any,
        { type: "web_fetch_20260209", name: "web_fetch", max_uses: 2 } as any,
      ],
      messages: [{
        role: "user",
        content:
          `Research where enterprise-software and major procurement DECISIONS are made for ${ent.canonical_name}${ent.hq_state ? ` (${ent.hq_state})` : ""}, a US utility/energy company. ` +
          `Key question: does it operate autonomously (own CFO/CIO sign for major systems), or does a corporate parent centralize IT/procurement/shared services? ` +
          `Evidence to look for: whether it is a subsidiary and of whom; centralized shared-services or procurement organizations at the parent; a single ERP/IT organization across the family; where the CIO/CFO for the family sit. ` +
          `Budget: up to 2 searches + 2 page fetches. Report what you found with the URL of the best source. If evidence is thin, say so.`,
      }],
    }));
    const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
    if (!notes) return NextResponse.json({ error: "Research came back empty — try again." }, { status: 502 });

    const extract = await withRetry(() => client.messages.create({
      model: "claude-sonnet-5", max_tokens: 2000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "From the research notes, decide the decision locus for major software purchases at this company: " +
        "'local' (it signs for itself), 'corporate' (a parent decides — name it in `parent`), or 'mixed' (depends / shared). " +
        "parent = the deciding parent's name, or '' if local. note = 1-2 plain sentences a rep can act on. " +
        "source_url = the best URL from the notes ('' if none). confidence reflects the evidence.",
      messages: [{ role: "user", content: `Company: ${ent.canonical_name}\n\nResearch notes:\n${notes.slice(0, 14000)}` }],
    }));
    const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ draft: JSON.parse(text) });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
