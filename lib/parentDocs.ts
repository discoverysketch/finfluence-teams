// Deterministic parent-company context for a subsidiary that files nothing.
//
// A wholly-owned subsidiary has no filings of its own, but its PARENT is a
// filer, and three standard documents say useful things about it:
//
//   Exhibit 21  — "Subsidiaries of the Registrant", a Reg S-K Item 601 exhibit
//                 on every 10-K. It confirms ownership in the parent's own
//                 words and lists the siblings.
//   10-K        — usually names the subsidiary somewhere, even if only in a
//                 segment description. Berkshire names NFM exactly once.
//   Letter      — some parents publish a shareholder letter that discusses
//                 operating businesses far more candidly than the 10-K does.
//
// Same addressable-document approach as the proxy, MD&A and Item 1A: fetch by
// address, slice, extract. No web search, so no guessing and no drift.
/* eslint-disable @typescript-eslint/no-explicit-any */
const UA = { "User-Agent": "AccountFluency dan.wain1@gmail.com", "Accept-Encoding": "gzip, deflate" };

// Domiciles that appear in the right-hand column of Exhibit 21 and bleed onto
// the front of the next company name when the table is flattened.
const DOMICILE_PREFIX = /^(?:Delaware|Nebraska|Iowa|Texas|California|New York|Georgia|Illinois|Ohio|Kansas|Minnesota|Missouri|Utah|Massachusetts|Connecticut|Maryland|Virginia|Wisconsin|Indiana|Michigan|Tennessee|Arizona|Nevada|Oregon|Washington|Colorado|Florida|Pennsylvania|New Jersey|North Carolina|South Carolina|Oklahoma|Arkansas|Kentucky|Alabama|Louisiana|Canada|England|Ireland|Luxembourg|Bermuda|Netherlands|Germany|Australia|Israel|United Kingdom|Wyoming|Idaho|Montana|New Hampshire|Rhode Island|Vermont|Maine|Alaska|Hawaii|West Virginia|Mississippi|New Mexico|South Dakota|North Dakota|District of Columbia)\s+/i;

const clean = (html: string) =>
  html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&").replace(/&#8217;|&rsquo;/g, "'").replace(/&#8212;|&mdash;/g, "—")
    .replace(/\s+/g, " ").trim();

/**
 * Parents that publish a shareholder letter at a stable public address.
 *
 * Deliberately a short allow-list rather than a search: the letter only earns
 * its place when we know exactly where it is, and guessing a URL would put an
 * unverified document in front of a rep.
 */
const LETTERS: Record<string, { name: string; url: string; note: string }> = {
  "1067983": {
    name: "Berkshire Hathaway",
    url: "https://www.berkshirehathaway.com/letters/2025ltr.pdf",
    note: "Berkshire's shareholder letter and owner's manual describe an explicitly decentralised model: subsidiaries are run autonomously and head office does not impose shared systems.",
  },
};

export type ParentContext = {
  parentName: string | null;
  exhibit21: { url: string; filed: string; confirmed: boolean; siblings: string[]; raw: string } | null;
  tenK: { url: string; filed: string; mentions: string[] } | null;
  letter: { url: string; note: string } | null;
};

async function recent(cik: string) {
  const r = await fetch(`https://data.sec.gov/submissions/CIK${String(cik).padStart(10, "0")}.json`, { headers: UA });
  if (!r.ok) return null;
  const j: any = await r.json();
  return j?.filings?.recent?.form ? { rec: j.filings.recent, name: j.name as string } : null;
}

export async function fetchParentContext(parentCik: string, subsidiaryName: string): Promise<ParentContext> {
  const out: ParentContext = { parentName: null, exhibit21: null, tenK: null, letter: LETTERS[String(Number(parentCik))] ?? null };
  const meta = await recent(parentCik).catch(() => null);
  if (!meta) return out;
  out.parentName = meta.name ?? null;

  const { rec } = meta;
  const i = rec.form.indexOf("10-K");
  if (i < 0) return out;
  const acc = String(rec.accessionNumber[i]).replace(/-/g, "");
  const filed = String(rec.filingDate?.[i] ?? "");
  const base = `https://www.sec.gov/Archives/edgar/data/${Number(parentCik)}/${acc}`;

  // Match on the distinctive words of the name: "Nebraska Furniture Mart, Inc."
  // in our records against "Nebraska Furniture Mart" in the filing.
  const core = subsidiaryName.replace(/,?\s*(inc|llc|corp|corporation|company|co)\.?$/i, "").trim();
  const rx = new RegExp(core.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");

  // --- Exhibit 21: ownership, in the parent's own words, plus the siblings.
  try {
    const idxRes = await fetch(`${base}/index.json`, { headers: UA });
    if (idxRes.ok) {
      const idx: any = await idxRes.json();
      const file = (idx?.directory?.item ?? []).find((f: any) => /ex-?21|exhibit21/i.test(f.name));
      if (file) {
        const url = `${base}/${file.name}`;
        const res = await fetch(url, { headers: UA });
        if (res.ok) {
          const txt = clean(await res.text());
          // The exhibit is a two-column table ("Name | Domicile") flattened to
          // one line, so a captured run picks up the PREVIOUS row's domicile as
          // a prefix — "Delaware Acme Building Brands, Inc.". Strip a leading
          // domicile token, and drop the header row.
          const siblings = (txt.match(/[A-Z][A-Za-z&.,'\- ]{4,60}(?:Inc|LLC|Corporation|Company|Co|LP|Ltd)\.?/g) ?? [])
            .map((x) => x.replace(DOMICILE_PREFIX, "").trim())
            .filter((x) => x.length > 4 && !/^(Company Name|Domicile|State of Incorporation)/i.test(x))
            .filter((x, j, a) => a.indexOf(x) === j);
          // Keep the raw text. Sibling MATCHING must run against it, not the
          // parsed list: the name regex requires a corporate suffix, so a
          // subsidiary called "PacifiCorp" or "GEICO" never appears in
          // `siblings` even though it is plainly in the exhibit.
          out.exhibit21 = { url, filed, confirmed: rx.test(txt), siblings: siblings.slice(0, 400), raw: txt.slice(0, 60000) };
        }
      }
    }
  } catch { /* exhibit is optional */ }

  // --- 10-K: every place the parent names this subsidiary.
  try {
    const doc = String(rec.primaryDocument?.[i] ?? "");
    if (doc) {
      const res = await fetch(`${base}/${doc}`, { headers: UA });
      if (res.ok) {
        const txt = clean(await res.text());
        const mentions: string[] = [];
        for (const m of txt.matchAll(new RegExp(rx.source, "gi"))) {
          const at = m.index ?? 0;
          mentions.push(txt.slice(Math.max(0, at - 400), at + 600));
          if (mentions.length >= 6) break;
        }
        out.tenK = { url: `${base}/${doc}`, filed, mentions };
      }
    }
  } catch { /* optional */ }

  return out;
}
