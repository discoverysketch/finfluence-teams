/* eslint-disable @typescript-eslint/no-explicit-any */
// Product knowledge = the tenant's own admin-approved content cards (Solutions
// decks: Fusion ERP/EPM/SCM/Energy & Water, customer win stories). Keeps AI
// suggestions anchored to vetted material rather than model memory. Shared by
// the CFO-sim coach and the pre-call brief.
export async function loadKnowledge(supabase: any): Promise<string> {
  const { data: pack } = await supabase.from("content_packs").select("id").eq("is_default", true).maybeSingle();
  if (!pack) return "";
  const { data: units } = await supabase.from("units").select("id,title").eq("pack_id", pack.id);
  const rel = (units ?? []).filter((u: any) => /oracle|fusion|erp|epm|scm|hcm|cx|integration|energy|water|use case|customer|win/i.test(u.title));
  if (!rel.length) return "";
  const { data: cards } = await supabase.from("cards")
    .select("front, body_json, unit_id").in("unit_id", rel.map((u: any) => u.id)).limit(120);
  const titleOf: Record<string, string> = {};
  for (const u of rel) titleOf[u.id] = u.title;
  return (cards ?? []).map((c: any) => {
    const b = c.body_json || {};
    const bits = [b.whatItIs, b.whyItMatters, b.link, b.utility, b.worked].filter(Boolean).join(" ");
    return `[${titleOf[c.unit_id]}] ${c.front}: ${String(bits).slice(0, 320)}`;
  }).join("\n");
}
