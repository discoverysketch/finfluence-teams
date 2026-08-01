import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { withRetry, friendlyAiError } from "@/lib/aiRetry";
import { topicByKey } from "@/lib/negotiationTopics";
import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

// Answer a contract question from Oracle's published standard terms.
//
// Retrieval is Postgres full-text ranking, which costs nothing — only the final
// reading of the retrieved clauses is a model call. Answers are cached across
// the whole install rather than per tenant, because these documents are the
// same published terms for every customer: the second rep to ask a question
// pays nothing. The cache key includes the corpus tag, so reloading the
// documents retires every answer drawn from the older text.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    // The honest headline. "not_addressed" is a first-class outcome: plenty of
    // what customers ask for (renewal uplift caps, for instance) is settled in
    // the ordering document and appears nowhere in the standard terms. Saying
    // so is far more useful than dressing up a loosely related clause.
    coverage: { type: "string", enum: ["addressed", "partly_addressed", "not_addressed"] },
    answer: { type: "string" },
    position: { type: "string" },
    citations: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          doc_key: { type: "string" },
          clause: { type: "string" },
          quote: { type: "string" },
        },
        required: ["doc_key", "clause", "quote"],
      },
    },
    talking_points: { type: "array", items: { type: "string" } },
    watch_out: { type: "string" },
  },
  required: ["coverage", "answer", "position", "citations", "talking_points", "watch_out"],
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").replace(/[^a-z0-9 ?]/g, "").trim();

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { question: raw, topicKey } = await request.json().catch(() => ({}));
  const topic = topicKey ? topicByKey(topicKey) : undefined;
  const question = String(topic?.question ?? raw ?? "").trim();
  if (question.length < 8) return NextResponse.json({ error: "Ask a fuller question — a few words isn't enough to find the right clause." }, { status: 400 });
  if (question.length > 400) return NextResponse.json({ error: "That question is too long — try asking one thing at a time." }, { status: 400 });

  const admin = createAdminClient();
  const { data: tagRow } = await admin.from("app_settings").select("value").eq("key", "contract_corpus_tag").maybeSingle();
  const corpusTag = tagRow?.value ?? "none";
  const qhash = createHash("sha1").update(norm(question)).digest("hex");

  // Cached answers are free and identical for everyone — serve them first.
  const { data: hit } = await supabase.from("contract_answers")
    .select("answer_json, created_at").eq("qhash", qhash).eq("corpus_tag", corpusTag).maybeSingle();
  if (hit) return NextResponse.json({ ...hit.answer_json, cached: true, at: hit.created_at });

  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { data: chunks, error: rErr } = await admin.rpc("search_contracts", { q: question, k: 14 });
  if (rErr) return NextResponse.json({ error: `Contract search failed — ${rErr.message}` }, { status: 500 });
  if (!chunks?.length) {
    return NextResponse.json({ error: "Nothing in the loaded contract documents matches that. Try the wording the contract would use." }, { status: 404 });
  }

  const { data: docs } = await admin.from("contract_docs").select("doc_key, title, version_label, effective, source_url");
  const meta: Record<string, any> = {};
  for (const d of (docs ?? []) as any[]) meta[d.doc_key] = d;

  const passages = (chunks as any[]).map((c, i) =>
    `[${i + 1}] DOCUMENT: ${meta[c.doc_key]?.title ?? c.doc_key} (key: ${c.doc_key}, version ${meta[c.doc_key]?.version_label ?? "?"})\n` +
    `CLAUSE: ${c.heading ?? "(unnumbered)"}\n${c.body}`
  ).join("\n\n---\n\n");

  const client = new Anthropic();
  try {
    const res = await withRetry(() => client.messages.create({
      model: "claude-opus-4-8", max_tokens: 2500,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "You are briefing an Oracle sales rep on what Oracle's OWN published standard contract terms say, so they can hold a conversation with a customer's legal and procurement team. " +
        "Answer ONLY from the clauses supplied below. They are the entirety of what you may rely on.\n\n" +
        "coverage: 'addressed' if the supplied clauses genuinely settle the question; 'partly_addressed' if they bear on it but leave the substance open; " +
        "'not_addressed' if the standard documents simply do not cover it — many commercial asks (renewal uplift caps, bespoke payment terms, custom SLAs) are settled in the ordering document and appear nowhere in the standard terms. " +
        "Choosing 'not_addressed' when that is the truth is the RIGHT answer and far more useful than stretching a loosely related clause to fit.\n\n" +
        "answer: 2-4 sentences in plain English, no legalese, aimed at a salesperson rather than a lawyer.\n" +
        "position: one or two sentences stating Oracle's default position as the documents actually leave it.\n" +
        "citations: every clause you relied on. quote must be VERBATIM from the supplied text and under 45 words — never paraphrase inside a quote, never invent clause numbers. doc_key must be one of the keys given. clause = the clause heading as supplied.\n" +
        "talking_points: 2-4 short lines the rep can actually say — what the standard terms already give the customer, and where the request has to go to Deal Desk or Legal. Do NOT promise or predict any concession, discount or contractual change.\n" +
        "watch_out: the one thing most likely to trip the rep up here — a carve-out, an exclusion, a definition that does not mean what it sounds like, or a point they should not answer on their own.\n\n" +
        "Never state what Oracle 'will' agree to. Never invent a clause, number, figure or quote. If the clauses conflict or are ambiguous, say so plainly.",
      messages: [{ role: "user", content: `QUESTION: ${question}\n\nCLAUSES FROM ORACLE'S PUBLISHED STANDARD DOCUMENTS:\n\n${passages}` }],
    }, { timeout: 180_000 }));

    const parsed = JSON.parse(res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim());

    // A citation naming a document we did not supply is a fabrication — drop it
    // rather than render a clause reference the rep might repeat to a customer.
    parsed.citations = (parsed.citations ?? []).filter((c: any) => meta[c.doc_key]).map((c: any) => ({
      ...c,
      doc_title: meta[c.doc_key].title,
      version: meta[c.doc_key].version_label,
      effective: meta[c.doc_key].effective,
      url: meta[c.doc_key].source_url,
    }));
    parsed.question = question;
    parsed.topic_key = topic?.key ?? null;

    await admin.from("contract_answers").upsert(
      { qhash, corpus_tag: corpusTag, question, topic_key: topic?.key ?? null, answer_json: parsed },
      { onConflict: "qhash,corpus_tag" },
    );
    return NextResponse.json({ ...parsed, cached: false, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: `Couldn't read the contracts — ${friendlyAiError(e)}` }, { status: 502 });
  }
}
