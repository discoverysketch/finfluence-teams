// Reporting-line inference from titles — conservative heuristics so a found
// leadership roster lands as a sensible chart instead of a flat row. Chiefs
// report to the CEO; VPs/directors report to the chief of their domain; anyone
// unmatched defaults to the CEO. Reps can re-wire in one tap.
export type PersonLite = { id: string; title: string | null };

const t = (p: PersonLite) => (p.title || "").toLowerCase();

export function findCeo<T extends PersonLite>(all: T[]): T | undefined {
  return all.find((p) => /chief executive|(^|\W)ceo(\W|$)/.test(t(p)))
    ?? all.find((p) => /^president(\s|&|,|$)/.test(t(p)))
    ?? all.find((p) => /general manager|^gm(\W|$)/.test(t(p)));
}

// Acronyms need \b — otherwise "direCTOr" matches /cto/ and "COOrdinator" matches /coo/.
const DOMAINS: [RegExp, RegExp][] = [
  [/financ|account|treasur|tax|audit|controller/, /chief financial|\bcfo\b/],
  [/legal|counsel|compliance|regulatory/, /chief legal|general counsel/],
  [/tech|digital|information|cyber|data|\bits?\b/, /chief (information|technology|digital)|\bcio\b|\bcto\b|digital transformation/],
  [/operat|asset|plant|generation|grid/, /chief operating|\bcoo\b|asset management and operations/],
  [/commercial|sales|marketing|revenue/, /chief commercial|chief revenue|\bcco\b/],
  [/develop/, /chief development/],
  [/customer/, /chief customer/],
  [/people|human resources|talent|\bhr\b/, /chief people|chief human/],
];

// Returns reports_to links for `targets` (subset of `all`), never self-links.
export function inferReporting<T extends PersonLite>(all: T[], targets: T[]): { id: string; reports_to: string }[] {
  const ceo = findCeo(all);
  const links: { id: string; reports_to: string }[] = [];
  for (const p of targets) {
    if (ceo && p.id === ceo.id) continue;
    const ti = t(p);
    let boss: T | undefined;
    const isChief = /chief .* officer|chief [a-z]+ officer|^c[a-z]{1,2}o(\W|$)/.test(ti) || /^chief /.test(ti);
    if (!isChief) {
      for (const [dom, bossRe] of DOMAINS) {
        if (dom.test(ti)) { boss = all.find((q) => q.id !== p.id && bossRe.test(t(q))); if (boss) break; }
      }
    }
    if (!boss && ceo && ceo.id !== p.id) boss = ceo;
    if (boss) links.push({ id: p.id, reports_to: boss.id });
  }
  return links;
}

// Children map + roots for rendering; cycle-safe.
export function buildTree<T extends { id: string; reports_to?: string | null }>(all: T[]): { kids: Record<string, T[]>; roots: T[] } {
  const kids: Record<string, T[]> = {};
  const ids = new Set(all.map((c) => c.id));
  const roots: T[] = [];
  for (const c of all) {
    if (c.reports_to && ids.has(c.reports_to)) (kids[c.reports_to] ??= []).push(c);
    else roots.push(c);
  }
  const seen = new Set<string>();
  const mark = (c: T) => { if (seen.has(c.id)) return; seen.add(c.id); (kids[c.id] ?? []).forEach(mark); };
  roots.forEach(mark);
  for (const c of all) if (!seen.has(c.id)) { roots.push(c); mark(c); }
  return { kids, roots };
}
