import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
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
      decision_at: new Date().toISOString(),
    }).eq("id", entityId);
    if (error) return NextResponse.json({ error: `${error.message} (run migration 0018?)` }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const client = new Anthropic();
  try {
    // Shared definition (lib/researchTasks) — identical to what the batch sweep runs.
    const { data: draft } = await withRetry(() => runTask(client, ent as any, "decision"));
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
