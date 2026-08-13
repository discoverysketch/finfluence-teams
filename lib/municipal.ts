// Where a US public power authority or municipal utility publishes the things
// a seller actually wants to see.
//
// These accounts have no SEC filings, which made them look like the thinnest in
// the book. They are in fact the richest: a public body has to publish what it
// intends to buy, what it has approved, and what it has spent. An RFP for an
// ERP replacement is not an inference about a possible deal — it is a live one
// with a closing date.
//
// There is no national index, exactly as with rate case dockets. Cities and
// authorities each run their own portal, so the search is scoped to the
// account's own domain plus the e-procurement platforms most of them use.

/** Platforms that host public-sector solicitations for many agencies at once. */
export const PROCUREMENT_PLATFORMS = [
  "bonfirehub.com", "gobonfire.com",       // Bonfire
  "procurement.opengov.com",                // OpenGov (formerly ProcureNow)
  "bidnetdirect.com",                       // BidNet
  "demandstar.com",
  "ionwave.net",
  "vendorregistry.com",
  "bidexpress.com",
  "periscopeholdings.com", "bidbuy.illinois.gov",
];

/** Document types worth finding, in rough order of how actionable they are. */
export const DOC_TYPES = [
  "RFP (request for proposals)",
  "RFI / RFQ",
  "ITB (invitation to bid)",
  "contract award or notice of intent to award",
  "board or council agenda item and staff report",
  "adopted budget and capital improvement plan",
  "annual comprehensive financial report (ACFR)",
  "municipal bond official statement (EMMA)",
];

/**
 * The source plan, scoped to this account. Passed straight into the research
 * prompt, so it names real places rather than telling the model to search.
 */
export function municipalSourcePlan(name: string, website: string | null, hqState: string | null): string {
  const domain = website ? website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] : null;
  const own = domain
    ? `their own site (${domain}) — try its procurement, purchasing, bids, supplier or "doing business with us" section, and its board or commission meeting page`
    : `their own site — its procurement, purchasing, bids or supplier section, and its board or commission meeting page`;

  return (
    `${name} is a public body, so what it intends to buy and what it has approved are PUBLISHED. Do not search the SEC — there is nothing there. ` +
    `Look, in order: (1) ${own}; ` +
    `(2) the e-procurement platforms public agencies use — ${PROCUREMENT_PLATFORMS.slice(0, 6).join(", ")} — searching for the agency by name; ` +
    `(3) their board, commission or city council agendas, packets and minutes, which name systems and approve contracts by vendor and dollar amount; ` +
    `(4) their adopted budget and capital improvement plan for IT or enterprise-systems line items; ` +
    `(5) their annual comprehensive financial report (ACFR); ` +
    `(6) municipal bond official statements on EMMA (emma.msrb.org)${hqState ? `, and the ${hqState} state procurement portal` : ""}. ` +
    `Find the ACTUAL documents, not news articles about them — a news story saying a board "approved a technology upgrade" is far less useful than the agenda item naming the vendor and the amount.`
  );
}
