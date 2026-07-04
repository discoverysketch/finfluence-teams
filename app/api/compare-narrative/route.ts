import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// Claude narrative comparing 2–4 accounts for a rep's CFO planning (SPEC §7c
// comparison workbench). Grounded in the passed figures; no fabrication.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { companies } = await request.json().catch(() => ({}));
  if (!Array.isArray(companies) || companies.length < 2) return NextResponse.json({ error: "Pick at least two accounts." }, { status: 400 });

  const fmt = (f: any) => Object.entries(f || {}).map(([k, v]) => `${k}=${v}`).join(", ");
  const block = companies.slice(0, 4).map((c: any) => `${c.company} (${c.period || "latest"}): ${fmt(c.facts)}`).join("\n");
  const prompt =
    `You coach a B2B software rep planning a utilities territory. In ONE short paragraph (3–5 sentences, no preamble, no lists), compare the companies below on the dimensions that matter to a CFO conversation — relative size, leverage, capex intensity, and cash generation — and say which looks like the strongest near-term opportunity and why. Ground every claim in the figures ($ millions); don't invent numbers.\n\n${block}`;

  try {
    const res = await new Anthropic().messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1200,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
    return NextResponse.json({ text });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Narrative failed — ${msg}` }, { status: 502 });
  }
}
