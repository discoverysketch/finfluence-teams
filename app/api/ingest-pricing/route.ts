import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Ingest Oracle's public Fusion price-list PDF into pricing_products. Admin
// pastes the public Oracle URL (default provided); the server fetches the PDF,
// Claude structures the utility-relevant SaaS SKUs, and we replace the table.
// Re-run any time Oracle updates the list — always current, always public.
export const maxDuration = 300;
/* eslint-disable @typescript-eslint/no-explicit-any */

const DEFAULT_URL = "https://www.oracle.com/a/ocom/docs/corporate/pricing/oracle-fusion-cloud-global-price-list.pdf";
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    products: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" }, metric: { type: "string" }, list_price: { type: "number" },
          currency: { type: "string" }, family: { type: "string", enum: ["ERP", "EPM", "SCM", "HCM", "EnergyWater"] },
        },
        required: ["name", "metric", "list_price", "currency", "family"],
      },
    },
    asOf: { type: "string" },
  },
  required: ["products", "asOf"],
};

export async function POST(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.from("users").select("role").eq("id", user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "Admins only" }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set on the server." }, { status: 500 });

  const { url } = await request.json().catch(() => ({}));
  const src = String(url || DEFAULT_URL);
  if (!/^https?:\/\/.*\.pdf(\?|$)/i.test(src)) return NextResponse.json({ error: "Point to a public price-list PDF URL." }, { status: 400 });

  let data = "";
  try {
    const r = await fetch(src, { headers: { "User-Agent": "Mozilla/5.0 AccountFluency" }, signal: AbortSignal.timeout(60000) });
    if (!r.ok) return NextResponse.json({ error: `Couldn't fetch the PDF (${r.status}).` }, { status: 502 });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 20 * 1024 * 1024) return NextResponse.json({ error: "PDF too large (>20MB)." }, { status: 413 });
    data = buf.toString("base64");
  } catch { return NextResponse.json({ error: "Couldn't download the PDF — check the URL." }, { status: 502 }); }

  const client = new Anthropic();
  try {
    const res = await client.messages.create({
      model: "claude-opus-4-8", max_tokens: 8000,
      output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
      system:
        "Extract SaaS subscription LIST prices from this Oracle price-list PDF. ONLY products a utility ERP seller uses: " +
        "Fusion Cloud ERP/Financials, EPM (planning/close/EDM), SCM/Procurement, HCM/HR/Payroll, and Oracle Energy & Water if present. " +
        "For each: name (as printed), metric (the exact pricing unit, e.g. 'Hosted Employee/month' or 'Hosted Named User/month'), " +
        "list_price (the number only), currency, family (ERP|EPM|SCM|HCM|EnergyWater). Use ONLY prices printed in the document — never invent. " +
        "asOf = the effective date printed. Keep to the ~35 most relevant SKUs.",
      messages: [{ role: "user", content: [
        { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data } },
        { type: "text" as const, text: "Extract the utility-relevant Fusion SaaS list prices." },
      ] }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
    const parsed = JSON.parse(text);
    const rows = (parsed.products ?? []).filter((p: any) => p.name && isFinite(p.list_price)).slice(0, 40)
      .map((p: any, i: number) => ({ family: p.family, name: String(p.name).slice(0, 160), metric: String(p.metric).slice(0, 60), list_price: p.list_price, currency: p.currency || "USD", ord: i, as_of: parsed.asOf || null }));
    if (!rows.length) return NextResponse.json({ error: "No prices extracted — is this the right PDF?" }, { status: 502 });

    const admin = createAdminClient();
    await admin.from("pricing_products").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const { error } = await admin.from("pricing_products").insert(rows);
    if (error) return NextResponse.json({ error: `${error.message} (run migration 0021?)` }, { status: 500 });
    return NextResponse.json({ ok: true, count: rows.length, asOf: parsed.asOf });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: `Ingest failed — ${msg}` }, { status: 502 });
  }
}
