/* eslint-disable @typescript-eslint/no-explicit-any */
// Client-side story harvesting shared by the Path showcase and the Content
// editor: call the proof-point researcher (admin-gated server route) and save
// results straight into the target unit, skipping customers already covered.
export const STORY_BUCKETS: [string, string][] = [
  ["Cloud ERP & financials", "Oracle Cloud ERP financials general ledger"],
  ["EPM · planning & close", "Oracle EPM financial planning and close"],
  ["Primavera · capital projects", "Primavera P6 capital project management"],
  ["Aconex · construction", "Oracle Aconex construction project delivery"],
  ["SCM · procurement", "Oracle Fusion SCM procurement supply chain"],
  ["Energy & Water · CIS/meter/grid", "Oracle Energy and Water customer care billing meter data"],
];

export const customerOf = (front: string) => String(front).split("—")[0].trim().toLowerCase();

// One topic search -> insert new stories into the unit. Returns added count.
export async function searchStories(opts: {
  supabase: any; unitId: string; topic: string; covered: Set<string>; startOrder: number;
}): Promise<{ added: number; error?: string }> {
  const { supabase, unitId, topic, covered, startOrder } = opts;
  const r = await fetch("/api/research-proofs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, count: 8, exclude: [...covered].slice(0, 80) }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.cards) return { added: 0, error: j?.error };
  let added = 0, order = startOrder;
  for (const c of j.cards as any[]) {
    const cust = customerOf(c.front || "");
    if (!cust || covered.has(cust)) continue;
    const { error } = await supabase.from("cards").insert({
      unit_id: unitId, type: "flashcard", order: order++, is_seeded: false,
      front: c.front || "", concept_tag: c.concept_tag || null,
      body_json: { prompt: c.prompt, whatItIs: c.whatItIs, whyItMatters: c.whyItMatters, link: c.link, utility: c.utility, worked: c.worked },
    });
    if (!error) { covered.add(cust); added++; }
  }
  return { added };
}
