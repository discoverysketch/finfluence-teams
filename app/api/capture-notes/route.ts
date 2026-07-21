import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { NextResponse } from "next/server";

// Post-call capture: rough pasted notes -> a clean activity entry + extracted
// next-step tasks + a stage suggestion. Returns a DRAFT for the rep to review;
// nothing is saved until they approve (client inserts via their own RLS-scoped
// session). Feeds the same activity log the pre-call brief reads — the loop.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const STAGES = ["prospect", "discovery", "evaluation", "proposal", "negotiation", "closed_won", "closed_lost"];
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    kind: { type: "string", enum: ["call", "meeting", "note"] },
    note: { type: "string" },
    tasks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { body: { type: "string" }, due_days: { type: "integer" } },
        required: ["body", "due_days"],
      },
    },
    stage_suggestion: { type: "string", enum: [...STAGES, ""] },
    stage_reason: { type: "string" },
  },
  required: ["kind", "note", "tasks", "stage_suggestion", "stage_reason"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { accountId, raw } = await request.json().catch(() => ({}));
  if (!accountId || !String(raw || "").trim()) return NextResponse.json({ error: "Missing notes" }, { status: 400 });

  const { data: acct } = await supabase.from("accounts")
    .select("id, crm_stage, entity:entities(canonical_name)").eq("id", accountId).maybeSingle();
  const ent: any = acct?.entity;
  if (!ent) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const { data: contacts } = await supabase.from("contacts").select("name, title").eq("account_id", accountId);

  const client = new Anthropic();
  try {
    const final = await withRetry(async () => {
      const stream = client.messages.stream({
      model: "claude-opus-4-8", max_tokens: 2500,
      thinking: { type: "adaptive" } as any,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        `A sales rep just typed rough notes after an interaction at ${ent.canonical_name} (current deal stage: ${acct!.crm_stage || "prospect"}). Structure them. Rules:\n` +
        "- kind: call/meeting if the notes describe one; note otherwise.\n" +
        "- note: the notes rewritten as a clean, complete record in the rep's voice — keep EVERY fact, name, number, objection, and commitment; fix only structure and clarity. 3-8 sentences. Never add information that isn't in the raw notes.\n" +
        "- tasks: each concrete follow-up or commitment as its own task (imperative, specific, include who/what). due_days = working guess at days from now (7 if unstated). No invented tasks.\n" +
        "- stage_suggestion: ONLY if the notes clearly indicate the deal moved (e.g. demo scheduled -> evaluation, verbal yes -> negotiation); otherwise empty string. stage_reason: one short sentence, or empty.\n" +
        (contacts?.length ? `Known people at the account: ${contacts.map((c: any) => c.name).join(", ")}. Match name spellings to these when clearly the same person.\n` : ""),
        messages: [{ role: "user", content: `RAW NOTES:\n${String(raw).slice(0, 6000)}` }],
      });
      return stream.finalMessage();
    });
    const text = final.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    return NextResponse.json({ draft: JSON.parse(text) });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't structure the notes — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
