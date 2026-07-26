import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { fetchProxy, fetchLeadershipDocs } from "@/lib/proxy";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// "What leadership is saying": management's OWN publicly-stated priorities,
// pulled from the latest earnings call + 10-K MD&A/strategy + recent 8-Ks.
// Quotes and sources only — the rep's homework, done. Cached on the shared
// entity (whole team benefits), re-runnable.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    summary: { type: "string" },
    priorities: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          theme: { type: "string" },
          detail: { type: "string" },
          quote: { type: "string" },
          who: { type: "string" },
          source: { type: "string" },
          angle: { type: "string" },
        },
        required: ["theme", "detail", "quote", "who", "source", "angle"],
      },
    },
    as_of: { type: "string" },
  },
  required: ["summary", "priorities", "as_of"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const gate = await canResearch(supabase, user.id, { entityId });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { data: ent } = await supabase.from("entities").select("id, canonical_name, ticker, hq_state, cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });

  const client = new Anthropic();
  try {
    // Shared definition (lib/researchTasks) so the batch sweep and this button
    // research every account to exactly the same standard.
    const { data: parsed } = await withRetry(() => runTask(client, ent as any, "priorities", fetchProxy, fetchLeadershipDocs));
    parsed.priorities = (parsed.priorities ?? []).filter((p: any) => /^https?:\/\//.test(p.source)).slice(0, 8);
    if (!parsed.priorities.length) return NextResponse.json({ error: "No citable priorities found — try again." }, { status: 502 });

    const admin = createAdminClient();
    await admin.from("entities").update({ priorities_json: parsed, priorities_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ priorities: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
