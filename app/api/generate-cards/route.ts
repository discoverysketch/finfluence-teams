import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// AI card drafting. Admin-only. Returns DRAFTS — never writes to the DB.
// Human-in-the-loop: the admin reviews/edits and approves each card in the UI
// before it is saved (SPEC / CLAUDE.md: never auto-publish AI content).

const CONCEPTS = ["prof", "liq", "ret", "cash", "found"] as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          front: { type: "string" },
          concept_tag: { type: "string", enum: [...CONCEPTS] },
          prompt: { type: "string" },
          whatItIs: { type: "string" },
          whyItMatters: { type: "string" },
          link: { type: "string" },
          utility: { type: "string" },
          worked: { type: "string" },
        },
        required: ["front", "concept_tag", "prompt", "whatItIs", "whyItMatters", "link", "utility", "worked"],
      },
    },
  },
  required: ["cards"],
};

export async function POST(request: Request) {
  // Gate: signed-in admin only.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server. Add it in .env.local (and Vercel) and redeploy." }, { status: 500 });
  }

  const { source, unitTitle, count } = await request.json().catch(() => ({}));
  const src = String(source || "").trim();
  if (src.length < 40) return NextResponse.json({ error: "Paste at least a paragraph of source material." }, { status: 400 });
  const n = Math.min(Math.max(Number(count) || 5, 1), 8);

  const client = new Anthropic();
  const system =
    "You are a financial-literacy curriculum author for FinFluency, a sales-enablement app that teaches reps to read utility-company financials. " +
    "You turn source material into concise flashcards. Every card is faithful to the source — never invent figures. " +
    "Cards are for salespeople selling to CFOs/treasurers at electric & gas utilities, so lean into a utility lens where natural. " +
    "Concept tags: prof = Profitability, liq = Liquidity & Leverage, ret = Returns, cash = Cash & Capital, found = Foundations. " +
    "Keep each field to 1-2 sentences. 'front' is the term/concept (2-5 words). 'prompt' is a one-line question shown on the card front. " +
    "'worked' is a short numeric example (use round illustrative numbers if the source lacks them, and say so). " +
    "If a field genuinely doesn't apply, use an empty string.";
  const prompt =
    `Draft ${n} flashcards for the unit titled "${unitTitle || "Financial Foundations"}" from the source material below.\n\n` +
    `--- SOURCE ---\n${src.slice(0, 12000)}\n--- END SOURCE ---`;

  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    let cards: unknown = [];
    try { cards = JSON.parse(text).cards; } catch { return NextResponse.json({ error: "The model returned an unparseable draft — try again." }, { status: 502 }); }
    return NextResponse.json({ cards });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Generation failed — ${msg}` }, { status: 502 });
  }
}
