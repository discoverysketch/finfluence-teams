// Seeds the default content pack (units + flashcards) from content.json into the tenant.
// Uses the service-role key (bypasses RLS). Run: npm run seed
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const content = JSON.parse(readFileSync(new URL("./content.json", import.meta.url)));

// Single-tenant for now: seed the oldest tenant.
const { data: tenants, error: te } = await db.from("tenants").select("id,name").order("created_at").limit(1);
if (te) throw te;
if (!tenants?.length) {
  console.error("No tenant found — create one first (see README).");
  process.exit(1);
}
const tenantId = tenants[0].id;
console.log("Seeding tenant:", tenants[0].name, `(${tenantId})`);

// Reset the default pack so re-running is idempotent (cascade removes its units + cards).
await db.from("content_packs").delete().eq("tenant_id", tenantId).eq("is_default", true);
const { data: pack, error: pe } = await db
  .from("content_packs")
  .insert({ tenant_id: tenantId, name: "Financial Fluency", description: "Curriculum + Oracle solutions", is_default: true })
  .select("id")
  .single();
if (pe) throw pe;

const backBody = (c, deck) => ({
  prompt: c.p ?? null,
  whatItIs: c.a ?? null,
  whyItMatters: c.b ?? null,
  link: c.c ?? null, linkLabel: deck.tl ?? null,
  utility: c.d ?? null, utilityLabel: deck.dl ?? "⚡ Utility lens",
  worked: c.ex ?? null, workedLabel: deck.exl ?? "🧮 Worked example",
});

let unitOrder = 0, unitCount = 0, cardCount = 0;
async function seedDecks(decks) {
  for (const deck of decks) {
    const { data: unit, error: ue } = await db
      .from("units")
      .insert({ pack_id: pack.id, title: deck.n, order: unitOrder++, icon: deck.ic ?? null })
      .select("id")
      .single();
    if (ue) throw ue;
    unitCount++;
    const rows = deck.cards.map((c, i) => ({
      unit_id: unit.id, type: "flashcard", front: c.t, body_json: backBody(c, deck), order: i,
    }));
    const { error: ce } = await db.from("cards").insert(rows);
    if (ce) throw ce;
    cardCount += rows.length;
  }
}
await seedDecks(content.units);
await seedDecks(content.solutions);
console.log(`Seeded ${unitCount} units, ${cardCount} cards into pack ${pack.id}.`);
