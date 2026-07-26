// Company logos with no new lookups and no API cost.
//
// We never stored a website, but research results already contain URLs — often
// the company's own careers site (jobs.exeloncorp.com, careers.dteenergy.com).
// This pulls the root domain out of what's already on the entity, and only
// trusts it when the domain actually echoes the company name, which throws out
// the job boards and aggregators that appear alongside (fool.com, tealhq.com).
// No match means a monogram, not a wrong logo.
/* eslint-disable @typescript-eslint/no-explicit-any */

const AGGREGATORS = /linkedin|indeed|glassdoor|ziprecruiter|builtin|stocktitan|sec\.gov|studylib|localjobnetwork|myworkdayjobs|icims|greenhouse|taleo|oraclecloud|wikipedia|bloomberg|reuters|prnewswire|businesswire|globenewswire|yahoo|marketwatch|investing|nasdaq|fool\.com|tealhq|theladders|ihire|wayup|climatebase|simplyhired|monster|dice\.com|talent|jobs?\.com|google|facebook|twitter|youtube/i;

// Hand-checked domains for companies whose own URLs never appeared in research.
// Static data, no lookup. Keyed on a distinctive lowercase fragment of the
// canonical name. Only entries worth being confident about — a wrong domain
// shows another company's logo, which is worse than initials.
const KNOWN: [RegExp, string][] = [
  [/consolidated edison/i, "coned.com"],
  [/american electric power/i, "aep.com"],
  [/duke energy/i, "duke-energy.com"],
  [/southern co/i, "southerncompany.com"],
  [/public service enterprise/i, "pseg.com"],
  [/national grid plc/i, "nationalgrid.com"],
  [/national grid renewables/i, "nationalgridrenewables.com"],
  [/dte energy/i, "dteenergy.com"],
  [/aes/i, "aes.com"],
  [/santee cooper/i, "santeecooper.com"],
  [/colorado springs/i, "csu.org"],
  [/long island power/i, "lipower.org"],
  [/jea/i, "jea.com"],
  [/talen energy/i, "talenenergy.com"],
  [/spire inc/i, "spireenergy.com"],
  [/ormat/i, "ormat.com"],
  [/chesapeake utilities/i, "chesapeakeutilities.com"],
  [/avery dennison/i, "averydennison.com"],
  [/core laboratories/i, "corelab.com"],
  [/genuine parts/i, "genpt.com"],
  [/x-energy/i, "x-energy.com"],
  [/rwe/i, "rwe.com"],
  [/scout clean energy/i, "scoutcleanenergy.com"],
  [/clean energy fuels/i, "cleanenergyfuels.com"],
  [/edison international/i, "edison.com"],
  [/dick's sporting/i, "dickssportinggoods.com"],
  [/eversource/i, "eversource.com"],
  [/exelon/i, "exeloncorp.com"],
];

// "CONSOLIDATED EDISON INC" -> ["consolidated","edison"]
function tokens(name: string): string[] {
  return String(name).toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !["inc","corp","company","holdings","group","the","and","energy","utilities","utility","power","electric","gas","international","resources"].includes(t));
}

const rootOf = (host: string) => {
  const parts = host.replace(/^www\./, "").split(".");
  return parts.length > 2 ? parts.slice(-2).join(".") : parts.join(".");
};

// Domain is accepted only if it shares a distinctive token with the company
// name — "exeloncorp.com" for Exelon passes, "fool.com" does not.
export function companyDomain(name: string, blobs: unknown[]): string | null {
  const known = KNOWN.find(([re]) => re.test(name));
  if (known) return known[1];
  const urls = (JSON.stringify(blobs).match(/https?:\/\/[^"\\ ]+/g) ?? []);
  const toks = tokens(name);
  const seen = new Set<string>();
  for (const u of urls) {
    let host = "";
    try { host = new URL(u).hostname; } catch { continue; }
    if (AGGREGATORS.test(host)) continue;
    const root = rootOf(host);
    if (seen.has(root)) continue;
    seen.add(root);
    const bare = root.split(".")[0].replace(/[^a-z0-9]/g, "");
    if (toks.some((t) => bare.includes(t) || t.includes(bare))) return root;
  }
  // NO guessing from the name. A single-token guess produced american.com for
  // AEP, enterprise.com for PSEG and consolidated.com for Con Edison — real
  // sites belonging to other companies. A wrong logo is worse than initials.
  return null;
}

// Google's public favicon endpoint: free, no key, no account, cached by the
// browser. A miss just fails the <img>, which falls back to the monogram.
export const logoSrc = (domain: string, size = 128) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=${size}`;

// Stable colour per company so the monogram doesn't change between loads.
const PALETTE = ["#B23A2E", "#0572CE", "#006B72", "#6A3E8E", "#1B7A47", "#9A6700", "#5B5245"];
export function monogram(name: string): { initials: string; color: string } {
  const words = String(name).replace(/[^A-Za-z0-9 ]/g, " ").split(/\s+/).filter(Boolean);
  const initials = (words[0]?.[0] ?? "?") + (words[1]?.[0] ?? "");
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return { initials: initials.toUpperCase(), color: PALETTE[h % PALETTE.length] };
}
