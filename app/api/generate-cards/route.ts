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

// Big batches (25 cards from multiple PDFs) can run a few minutes.
export const maxDuration = 300;

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

  const { source, unitTitle, count, pdfs, pdfBase64 } = await request.json().catch(() => ({}));
  const src = String(source || "").trim();
  // Multiple PDFs per batch (each becomes a native document block); cap for
  // request-size sanity. pdfBase64 kept for backward compat.
  const pdfArr: string[] = (Array.isArray(pdfs) ? pdfs : [])
    .filter((s: unknown) => typeof s === "string" && (s as string).length > 100).slice(0, 4);
  if (typeof pdfBase64 === "string" && pdfBase64.length > 100 && !pdfArr.length) pdfArr.push(pdfBase64);
  if (!pdfArr.length && src.length < 40) return NextResponse.json({ error: "Upload a file or paste at least a paragraph of source material." }, { status: 400 });
  // Anthropic caps requests at 32MB — reject early with a clear message instead
  // of a cryptic API error.
  const totalPdfBytes = pdfArr.reduce((s, p) => s + p.length, 0);
  if (totalPdfBytes > 22 * 1024 * 1024) {
    return NextResponse.json({ error: `Attached PDFs are too large together (~${Math.round(totalPdfBytes / 1.33 / 1e6)}MB of PDF). Drop a file or use smaller ones — about 15MB of PDFs per batch is the ceiling.` }, { status: 413 });
  }
  const n = Math.min(Math.max(Number(count) || 5, 1), 25);

  const client = new Anthropic();
  const system =
    "You are a financial-literacy curriculum author for FinFluency, a sales-enablement app that teaches reps to read utility-company financials. " +
    "You turn source material into concise flashcards. Every card is faithful to the source — never invent figures. " +
    "Cards are for salespeople selling to CFOs/treasurers at electric & gas utilities, so lean into a utility lens where natural. " +
    "Concept tags: prof = Profitability, liq = Liquidity & Leverage, ret = Returns, cash = Cash & Capital, found = Foundations. " +
    "Keep each field to 1-2 sentences. 'front' is the term/concept (2-5 words). 'prompt' is a one-line question shown on the card front. " +
    "'worked' is a short numeric example (use round illustrative numbers if the source lacks them, and say so). " +
    "If a field genuinely doesn't apply, use an empty string.";
  const promptFor = (count: number, hasPdf: boolean, withSrc: boolean) =>
    `Draft ${count} flashcards for the unit titled "${unitTitle || "Financial Foundations"}" from ` +
    (hasPdf && withSrc ? "the attached document and the source text below" : hasPdf ? "the attached document" : "the source material below") +
    `. Cover the material broadly — avoid near-duplicate cards.` +
    (withSrc ? `\n\n--- SOURCE ---\n${src.slice(0, 24000)}\n--- END SOURCE ---` : "");

  // One model call per PDF, run in parallel: a single request carrying several
  // PDFs hits per-request limits (100 PDF pages / 32MB) and one long read can
  // blow the 300s function cap. Fan-out keeps each call small; wall time is the
  // slowest file, not the sum.
  const draft = async (content: Anthropic.MessageParam["content"], count: number) => {
    const stream = client.messages.stream({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      system,
      messages: [{ role: "user", content }],
    });
    const res = await stream.finalMessage();
    if (res.stop_reason === "max_tokens") throw new Error("draft ran out of room — ask for fewer cards");
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
    return (JSON.parse(text).cards ?? []) as any[];
  };

  const jobs: Promise<any[]>[] = [];
  if (pdfArr.length) {
    const per = Math.max(2, Math.ceil(n / pdfArr.length));
    pdfArr.forEach((data, i) => {
      const withSrc = i === 0 && src.length >= 40; // pasted text rides with the first file
      jobs.push(draft([
        { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } },
        { type: "text" as const, text: promptFor(per, true, withSrc) },
      ], per));
    });
  } else {
    jobs.push(draft(promptFor(n, false, true), n));
  }

  const settled = await Promise.allSettled(jobs);
  const okCards = settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []));
  const failures = settled.filter((s) => s.status === "rejected") as PromiseRejectedResult[];

  if (!okCards.length) {
    const first = failures[0]?.reason;
    const msg = first instanceof Anthropic.APIError ? `${first.status}: ${first.message}` : (first as Error)?.message || "unknown";
    return NextResponse.json({ error: `Generation failed — ${msg}` }, { status: 502 });
  }

  // Merge, drop near-duplicate fronts across files, cap at the requested count.
  const seen = new Set<string>();
  const cards = okCards.filter((c) => {
    const k = String(c?.front || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  }).slice(0, n);

  return NextResponse.json({
    cards,
    note: failures.length ? `${failures.length} of ${jobs.length} files failed to draft — the rest came through.` : undefined,
  });
}
