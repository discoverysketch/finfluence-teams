import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

// One-paragraph CFO talk track for a Peer Duel. Grounded in the two companies'
// cached figures; no fabrication.
/* eslint-disable @typescript-eslint/no-explicit-any */
export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { target, peer } = await request.json().catch(() => ({}));
  if (!target?.company || !peer?.company) return NextResponse.json({ error: "Missing companies" }, { status: 400 });

  const fmt = (f: any) => Object.entries(f || {}).map(([k, v]) => `${k}=${v}`).join(", ");
  const prompt =
    `You coach a B2B software rep who sells to utility CFOs. Write ONE tight paragraph (3–4 sentences, no preamble, no bullet points) the rep could actually say to the CFO of ${target.company}, comparing them to peer ${peer.company} using the figures below ($ millions). ` +
    `Ground every claim in the numbers; call out 1–2 concrete differences (size, leverage, capex intensity, or cash generation) and end with a forward-looking question that opens a conversation. Do not invent figures.\n\n` +
    `${target.company} (${target.period}): ${fmt(target.facts)}\n` +
    `${peer.company} (${peer.period}): ${fmt(peer.facts)}`;

  try {
    const res = await new Anthropic().messages.create({
      model: "claude-opus-4-8",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("").trim();
    return NextResponse.json({ text });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Talk track failed — ${msg}` }, { status: 502 });
  }
}
