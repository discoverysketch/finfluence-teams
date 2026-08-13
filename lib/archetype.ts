// What KIND of company this is, and therefore where its information lives.
//
// Every research prompt in this app used to say "a US utility". That is true of
// most of the book and useless for the rest: a wholly-owned Berkshire subsidiary
// has no SEC filings, no FERC Form 1 and no EIA data, so a utility-shaped search
// returns nothing and the account looks empty when it is merely different.
//
// The archetype picks the framing AND the source list, so the same research
// button does something sensible for a regulated utility, a listed company, a
// municipal authority and a private subsidiary.
export type Archetype = "regulated_utility" | "public_corp" | "private_subsidiary" | "municipal" | "unknown";

export type ArchetypeEnt = {
  canonical_name: string;
  ticker?: string | null;
  cik?: string | null;
  sic?: string | null;
  hq_state?: string | null;
  entity_type?: string | null;
  parent_name?: string | null;
};

// 49xx = utilities. 4911 electric, 4922-4924 gas, 4931 combination, 4941 water.
const UTILITY_SIC = /^49\d\d$/;
const MUNI_NAME = /\b(authority|municipal|public power|public service authority|district|city of|county of|co-?operative|cooperative|electric co-?op)\b/i;

export function inferArchetype(e: ArchetypeEnt): Archetype {
  if (e.sic && UTILITY_SIC.test(String(e.sic))) return "regulated_utility";
  if (!e.cik && MUNI_NAME.test(e.canonical_name)) return "municipal";
  if (e.entity_type && /muni|public power|authority/i.test(e.entity_type)) return "municipal";
  if (e.cik && e.ticker) return "public_corp";
  if (e.cik) return "public_corp";
  if (e.parent_name) return "private_subsidiary";
  return "unknown";
}

export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  regulated_utility: "Regulated utility",
  public_corp: "Listed company",
  private_subsidiary: "Private subsidiary",
  municipal: "Municipal / public power",
  unknown: "Unclassified",
};

/** How to describe the company inside a prompt, so searches are aimed correctly. */
export function descriptor(e: ArchetypeEnt, a: Archetype): string {
  const where = e.hq_state ? `, headquartered in ${e.hq_state}` : "";
  switch (a) {
    case "regulated_utility": return `${e.canonical_name}${e.ticker ? ` (${e.ticker})` : ""}, a US regulated utility${where}`;
    case "public_corp": return `${e.canonical_name}${e.ticker ? ` (${e.ticker})` : ""}, a US publicly listed company${where}`;
    case "municipal": return `${e.canonical_name}, a US municipal utility or public power authority${where}`;
    case "private_subsidiary": return `${e.canonical_name}, a privately held US company${e.parent_name ? ` owned by ${e.parent_name}` : ""}${where}`;
    default: return `${e.canonical_name}${where}`;
  }
}

/**
 * Where to look, per archetype. This is prompt text — it goes straight into the
 * research instruction, so it names real, checkable source types rather than
 * telling the model to "search the web".
 */
export function sourcePlan(a: Archetype, e: ArchetypeEnt): string {
  const local = e.hq_state ? `the local business press for ${e.hq_state} (business journals, the metro daily)` : "the local business press for its headquarters city";
  switch (a) {
    case "regulated_utility":
      return `Sources, in order: (1) their SEC filings and earnings call; (2) state utility commission filings and rate cases; (3) their investor presentations and capital plan; (4) trade press (Utility Dive, RTO Insider, S&P Global).`;
    case "public_corp":
      return `Sources, in order: (1) their most recent SEC filings and earnings call; (2) investor presentations; (3) trade press for their industry; (4) ${local}.`;
    case "municipal":
      return `This is a public body, so its records are public but are NOT with the SEC. Sources, in order: (1) their published annual comprehensive financial report (ACFR) and adopted budget; (2) board or council meeting agendas, packets and minutes — these name systems and approve contracts; (3) municipal bond official statements on EMMA; (4) RFPs, bid tabulations and awarded contracts; (5) ${local}.`;
    case "private_subsidiary":
      return `This company files NOTHING with the SEC, so do not waste searches there — at most the parent's 10-K names it in a list. ` +
        `Sources, in order: (1) their own careers site and job postings, which name the systems they actually run; (2) trade press for their industry — this is where private companies are covered in detail; ` +
        `(3) ${local}, especially "people on the move" columns and store, plant or distribution-centre announcements; ` +
        `(4) city council packets, economic development agreements and tax-increment filings for any facility they are building — these are public and carry real capital figures; ` +
        `(5) the parent's annual report or shareholder letter for how the parent runs its subsidiaries; (6) their own newsroom and press releases.`;
    default:
      return `Sources, in order: (1) their own website, newsroom and careers site; (2) trade press for their industry; (3) ${local}; (4) any regulatory or public filings that exist for a company of this type.`;
  }
}

/** Where the people information is, which differs sharply by archetype. */
export function peoplePlan(a: Archetype, e: ArchetypeEnt): string {
  const local = e.hq_state ? `${e.hq_state} business journals` : "local business journals";
  const common = `Collect ONLY public professional information: name, title, responsibilities, career background, and public statements. Never collect personal contact details, and never use LinkedIn scraping.`;
  switch (a) {
    case "regulated_utility":
    case "public_corp":
      return `${common} Sources: the proxy statement and 10-K for named executive officers, the company leadership page, 8-K Item 5.02 for recent appointments, earnings call participant lists, and conference speaker biographies.`;
    case "municipal":
      return `${common} Sources: the organisation's own leadership page, board and council meeting minutes (which name staff who present), the ACFR's letter of transmittal, and ${local}.`;
    case "private_subsidiary":
      return `${common} There is no proxy statement, so the usual executive list does not exist. Sources: the company's own leadership and newsroom pages, ${local} "people on the move" columns, trade-press interviews and conference speaker biographies, ` +
        `job postings that state who a role reports to (these reveal the org chart without naming anyone), and IRS Form 990 filings of local non-profits, which publicly list officers and directors and often place a company's executives by name and title.`;
    default:
      return `${common} Sources: the company's own leadership page, its newsroom, trade press and ${local}.`;
  }
}
