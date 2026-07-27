// State utility-commission registry.
//
// Why a registry rather than an API integration: rate case dockets are the
// single richest public source on utility IT spend — testimony is where a
// utility justifies capital under oath, so it names the systems it is
// replacing, the amounts, and the schedule. But there is no federal index of
// them. Every state runs its own commission on its own stack (Missouri is a
// stateful ASP.NET form post, California is a servlet, Michigan is Salesforce),
// so 40 bespoke adapters would be needed for national coverage.
//
// FERC eLibrary looked like the shortcut and is not one: its full-text search
// ignores boolean operators (a search for "Ameren AND Oracle" returns the same
// 229 relevance-ranked hits as "Ameren Oracle", topped by an Xcel filing),
// returns no matched snippets, and its documents are 20MB+ PDFs.
//
// So instead of integrating 40 systems, we point the search at the RIGHT one.
// Naming the commission and its filing-system domain turns an open-web search
// into a scoped one, which is most of the precision an adapter would buy.
//
// Every domain here was checked to resolve. A 403 to a scripted request is
// expected on several of them (they block non-browser agents) and does not
// matter — these are search hints, not endpoints we fetch.
export type Commission = { name: string; abbr: string; domain: string };

export const PUC: Record<string, Commission> = {
  AR: { name: "Arkansas Public Service Commission", abbr: "APSC", domain: "apscservices.info" },
  AZ: { name: "Arizona Corporation Commission", abbr: "ACC", domain: "docket.images.azcc.gov" },
  CA: { name: "California Public Utilities Commission", abbr: "CPUC", domain: "apps.cpuc.ca.gov" },
  CO: { name: "Colorado Public Utilities Commission", abbr: "COPUC", domain: "puc.colorado.gov" },
  CT: { name: "Connecticut Public Utilities Regulatory Authority", abbr: "PURA", domain: "portal.ct.gov" },
  DE: { name: "Delaware Public Service Commission", abbr: "DEPSC", domain: "depsc.delaware.gov" },
  FL: { name: "Florida Public Service Commission", abbr: "FPSC", domain: "floridapsc.com" },
  GA: { name: "Georgia Public Service Commission", abbr: "GAPSC", domain: "psc.ga.gov" },
  IA: { name: "Iowa Utilities Commission", abbr: "IUC", domain: "efs.iowa.gov" },
  IL: { name: "Illinois Commerce Commission", abbr: "ICC", domain: "icc.illinois.gov" },
  IN: { name: "Indiana Utility Regulatory Commission", abbr: "IURC", domain: "iurc.portal.in.gov" },
  KS: { name: "Kansas Corporation Commission", abbr: "KCC", domain: "estar.kcc.ks.gov" },
  KY: { name: "Kentucky Public Service Commission", abbr: "KYPSC", domain: "psc.ky.gov" },
  LA: { name: "Louisiana Public Service Commission", abbr: "LPSC", domain: "lpsc.louisiana.gov" },
  MA: { name: "Massachusetts Department of Public Utilities", abbr: "MA DPU", domain: "eeaonline.eea.state.ma.us" },
  MD: { name: "Maryland Public Service Commission", abbr: "MDPSC", domain: "www.psc.state.md.us" },
  MI: { name: "Michigan Public Service Commission", abbr: "MPSC", domain: "mi-psc.my.site.com" },
  MN: { name: "Minnesota Public Utilities Commission", abbr: "MPUC", domain: "efiling.web.commerce.state.mn.us" },
  MO: { name: "Missouri Public Service Commission", abbr: "MoPSC", domain: "efis.psc.mo.gov" },
  NC: { name: "North Carolina Utilities Commission", abbr: "NCUC", domain: "starw1.ncuc.gov" },
  NH: { name: "New Hampshire Public Utilities Commission", abbr: "NHPUC", domain: "puc.nh.gov" },
  NJ: { name: "New Jersey Board of Public Utilities", abbr: "NJBPU", domain: "publicaccess.bpu.state.nj.us" },
  NM: { name: "New Mexico Public Regulation Commission", abbr: "NMPRC", domain: "edocket.nmprc.state.nm.us" },
  NV: { name: "Public Utilities Commission of Nevada", abbr: "PUCN", domain: "puc.nv.gov" },
  NY: { name: "New York Public Service Commission", abbr: "NYPSC", domain: "documents.dps.ny.gov" },
  OH: { name: "Public Utilities Commission of Ohio", abbr: "PUCO", domain: "dis.puc.state.oh.us" },
  OK: { name: "Oklahoma Corporation Commission", abbr: "OCC", domain: "oklahoma.gov" },
  OR: { name: "Oregon Public Utility Commission", abbr: "OPUC", domain: "apps.puc.state.or.us" },
  PA: { name: "Pennsylvania Public Utility Commission", abbr: "PA PUC", domain: "puc.pa.gov" },
  SC: { name: "Public Service Commission of South Carolina", abbr: "SCPSC", domain: "dms.psc.sc.gov" },
  TX: { name: "Public Utility Commission of Texas", abbr: "PUCT", domain: "interchange.puc.texas.gov" },
  UT: { name: "Utah Public Service Commission", abbr: "UTPSC", domain: "psc.utah.gov" },
  VA: { name: "Virginia State Corporation Commission", abbr: "VA SCC", domain: "scc.virginia.gov" },
  WA: { name: "Washington Utilities and Transportation Commission", abbr: "WUTC", domain: "utc.wa.gov" },
  WI: { name: "Public Service Commission of Wisconsin", abbr: "PSCW", domain: "apps.psc.wi.gov" },
  WV: { name: "West Virginia Public Service Commission", abbr: "WVPSC", domain: "psc.state.wv.us" },
};

// A holding company's HQ state is often NOT where its biggest rate cases are.
// AEP is headquartered in Ohio but files in ten states; Duke is in North
// Carolina and files in six. Pointing the search only at the HQ commission
// would miss most of the filings, so known multi-state filers carry an
// explicit list, HQ/largest jurisdiction first.
export const FILING_STATES: { match: RegExp; states: string[] }[] = [
  { match: /american electric power|\bAEP\b/i, states: ["OH", "TX", "VA", "WV", "IN", "MI", "OK", "AR", "LA", "KY"] },
  { match: /duke energy/i, states: ["NC", "SC", "FL", "IN", "OH", "KY"] },
  { match: /dominion energy/i, states: ["VA", "SC", "NC", "UT", "OH", "WV"] },
  { match: /southern co|georgia power|alabama power/i, states: ["GA", "MS"] },
  { match: /exelon/i, states: ["IL", "PA", "MD", "NJ", "DE"] },
  { match: /firstenergy/i, states: ["OH", "PA", "WV", "NJ", "MD"] },
  { match: /ameren/i, states: ["MO", "IL"] },
  { match: /evergy/i, states: ["MO", "KS"] },
  { match: /xcel energy/i, states: ["MN", "CO", "TX", "NM", "WI"] },
  { match: /entergy/i, states: ["LA", "AR", "MS", "TX"] },
  { match: /eversource/i, states: ["MA", "CT", "NH"] },
  { match: /national grid/i, states: ["NY", "MA"] },
  { match: /nisource|nipsco|columbia gas/i, states: ["IN", "OH", "PA", "VA", "MD", "KY"] },
  { match: /public service enterprise|\bPSEG\b/i, states: ["NJ"] },
  { match: /consolidated edison|\bcon ed/i, states: ["NY"] },
  { match: /centerpoint/i, states: ["TX", "IN", "MN", "OH"] },
  { match: /\bDTE\b/i, states: ["MI"] },
  { match: /edison international|southern california edison/i, states: ["CA"] },
  { match: /avista/i, states: ["WA", "OR", "ID"] },
  { match: /spire/i, states: ["MO", "AL", "MS"] },
  { match: /unitil/i, states: ["NH", "MA", "ME"] },
  { match: /constellation energy/i, states: ["MD", "IL", "PA", "NY"] },
  { match: /chesapeake utilities/i, states: ["DE", "MD", "FL"] },
  { match: /\bRGC resources|roanoke gas/i, states: ["VA"] },
];

// Which commissions to point the search at, best first.
export function commissionsFor(name: string, hqState?: string | null): Commission[] {
  const known = FILING_STATES.find((f) => f.match.test(name));
  const codes = known ? known.states : hqState ? [hqState] : [];
  const out: Commission[] = [];
  for (const c of codes) if (PUC[c] && !out.some((o) => o.abbr === PUC[c].abbr)) out.push(PUC[c]);
  // Two, not four. A four-commission search for AEP ran past the function
  // limit and returned nothing at all; the two largest jurisdictions inside the
  // budget beat ten attempted and none delivered.
  return out.slice(0, 2);
}
