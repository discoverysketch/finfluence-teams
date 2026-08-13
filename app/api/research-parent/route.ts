import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { runTask } from "@/lib/researchTasks";
import { fetchParentContext } from "@/lib/parentDocs";
import { canResearch } from "@/lib/canResearch";
import { NextResponse } from "next/server";

// Parent context for a subsidiary that files nothing itself.
//
// Deterministic: Exhibit 21 ("Subsidiaries of the Registrant") is a standard
// exhibit on every 10-K, so ownership is CONFIRMED from the parent's own filing
// rather than assumed, and the sibling list comes free. No web search at all.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { entityId } = await request.json().catch(() => ({}));
  if (!entityId) return NextResponse.json({ error: "Missing account" }, { status: 400 });
  const gate = await canResearch(supabase, user.id, { entityId });
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 403 });

  const { data: ent } = await supabase.from("entities")
    .select("id, canonical_name, parent_name, parent_cik").eq("id", entityId).maybeSingle();
  if (!ent) return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  if (!ent.parent_cik) {
    return NextResponse.json({ error: "No parent company on file. Add the parent's SEC CIK to research it." }, { status: 400 });
  }

  const client = new Anthropic();
  try {
    const { data: parsed } = await withRetry(() =>
      runTask(client, ent as any, "parent", undefined, undefined, undefined, undefined, [], fetchParentContext));

    // Which of YOUR accounts share this parent. Matched against the raw exhibit
    // text rather than the parsed name list: Exhibit 21 is a two-column table
    // flattened to one line, so parsed names can carry a neighbouring domicile,
    // while a substring check on the raw text is exact.
    const exhibit = String(parsed._exhibitText ?? "").toLowerCase();
    delete parsed._exhibitText;
    if (exhibit) {
      const admin0 = createAdminClient();
      const { data: book } = await admin0.from("accounts").select("entity:entities(id, canonical_name)");
      parsed.siblings_in_book = ((book ?? []) as any[])
        .map((a) => a.entity).filter(Boolean)
        .filter((e: any) => e.id !== entityId)
        .filter((e: any) => {
          const core = String(e.canonical_name).replace(/,?\s*(inc|llc|corp|corporation|company|co)\.?$/i, "").trim();
          return core.length > 5 && exhibit.includes(core.toLowerCase());
        })
        .map((e: any) => e.canonical_name).slice(0, 12);
    }

    const admin = createAdminClient();
    await admin.from("entities").update({ parent_json: parsed, parent_at: new Date().toISOString() }).eq("id", entityId);
    return NextResponse.json({ parent: parsed, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Research failed — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
