// Structured job feeds, straight from the company's own applicant-tracking
// system. Free, complete and live — where the web search that preceded it
// returned "QUIET" for half the book while those companies had dozens of
// openings, because it never found the careers site.
//
// Job postings are also the single best public evidence of the systems a
// company runs, so one crawl feeds both the hiring signal and the battlecard.
/* eslint-disable @typescript-eslint/no-explicit-any */

const UA = { "User-Agent": "Mozilla/5.0 (compatible; AccountFluency/1.0; +mailto:dan.wain1@gmail.com)" };

export type Posting = {
  title: string; url: string; posted?: string; text?: string;
  // platform handles used to fetch the description, which is where the system
  // names live — neither Workday nor Oracle include it in the list payload.
  _path?: string; _id?: string;
};
export type AtsFeed = { platform: string; url: string; postings: Posting[]; total: number };

async function req(url: string, init: RequestInit = {}, ms = 15000): Promise<Response | null> {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...init, headers: { ...UA, ...(init.headers ?? {}) }, redirect: "follow", signal: c.signal }); }
  catch { return null; } finally { clearTimeout(t); }
}

// ---------------------------------------------------------------- detection
export function identify(url: string): { platform: string; a?: string; b?: string } | null {
  let m;
  if ((m = url.match(/([a-z0-9-]+)\.wd(\d+)\.myworkdayjobs\.com(?:\/[a-z-]+)?\/([A-Za-z0-9_-]+)/i)))
    return { platform: "workday", a: `${m[1]}.wd${m[2]}`, b: m[3] };
  if ((m = url.match(/([a-z0-9-]+\.fa\.[a-z0-9-]+\.oraclecloud\.com).*?\/sites\/([A-Za-z0-9_]+)/i)))
    return { platform: "oracle", a: m[1], b: m[2] };
  if ((m = url.match(/boards\.greenhouse\.io\/([a-z0-9-]+)/i))) return { platform: "greenhouse", a: m[1] };
  if ((m = url.match(/jobs\.lever\.co\/([a-z0-9-]+)/i))) return { platform: "lever", a: m[1] };
  // Dayforce (Ceridian). a = client namespace, b = career-site code. An employer
  // often runs one site per location, so b is optional and defaults to the
  // aggregate board.
  if ((m = url.match(/jobs\.dayforcehcm\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?([A-Za-z0-9_-]+)(?:\/([A-Za-z0-9_-]+))?/))) {
    return { platform: "dayforce", a: m[1], b: m[2] };
  }
  if ((m = url.match(/([a-z0-9-]+)\.taleo\.net/i))) return { platform: "taleo", a: m[1] };
  if ((m = url.match(/([a-z0-9-]+)\.icims\.com/i))) return { platform: "icims", a: m[1] };
  return null;
}

// ---------------------------------------------------------------- adapters
async function workday(tenantHost: string, site: string): Promise<AtsFeed | null> {
  const base = `https://${tenantHost}.myworkdayjobs.com/wday/cxs/${tenantHost.split(".")[0]}/${site}/jobs`;
  const out: Posting[] = [];
  let total = 0;
  for (let offset = 0; offset < 200; offset += 20) {
    const r = await req(base, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 20, offset, searchText: "" }),
    });
    if (!r || !r.ok) break;
    const j: any = await r.json().catch(() => null);
    if (!j?.jobPostings?.length) break;
    total = j.total ?? total;
    for (const p of j.jobPostings) {
      out.push({
        title: String(p.title ?? ""),
        url: `https://${tenantHost}.myworkdayjobs.com/en-US/${site}${p.externalPath ?? ""}`,
        posted: String(p.postedOn ?? ""),
        _path: String(p.externalPath ?? ""),
      });
    }
    if (out.length >= total) break;
  }
  return out.length ? { platform: "workday", url: base, postings: out, total: total || out.length } : null;
}

async function oracle(host: string, site: string): Promise<AtsFeed | null> {
  const url = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions?onlyData=true&expand=requisitionList&finder=findReqs;siteNumber=${site},limit=200,sortBy=POSTING_DATES_DESC`;
  const r = await req(url, {}, 30000);
  if (!r?.ok) return null;
  const j: any = await r.json().catch(() => null);
  const items = j?.items?.[0];
  const reqs = items?.requisitionList ?? [];
  if (!reqs.length) return null;
  return {
    platform: "oracle", url,
    total: items?.TotalJobsCount ?? reqs.length,
    postings: reqs.map((x: any) => ({
      title: String(x.Title ?? ""),
      url: `https://${host}/hcmUI/CandidateExperience/en/sites/${site}/job/${x.Id}`,
      posted: String(x.PostedDate ?? ""),
      _id: String(x.Id ?? ""),
    })),
  };
}

async function greenhouse(token: string): Promise<AtsFeed | null> {
  const url = `https://boards-api.greenhouse.io/v1/boards/${token}/jobs?content=true`;
  const r = await req(url);
  if (!r?.ok) return null;
  const j: any = await r.json().catch(() => null);
  const jobs = j?.jobs ?? [];
  if (!jobs.length) return null;
  return {
    platform: "greenhouse", url, total: jobs.length,
    postings: jobs.map((x: any) => ({
      title: String(x.title ?? ""), url: String(x.absolute_url ?? ""),
      posted: String(x.updated_at ?? ""), text: String(x.content ?? "").replace(/<[^>]+>/g, " "),
    })),
  };
}

async function lever(token: string): Promise<AtsFeed | null> {
  const url = `https://api.lever.co/v0/postings/${token}?mode=json`;
  const r = await req(url);
  if (!r?.ok) return null;
  const j: any = await r.json().catch(() => null);
  if (!Array.isArray(j) || !j.length) return null;
  return {
    platform: "lever", url, total: j.length,
    postings: j.map((x: any) => ({
      title: String(x.text ?? ""), url: String(x.hostedUrl ?? ""),
      posted: x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : "",
      text: [x.descriptionPlain, ...(x.lists ?? []).map((l: any) => String(l.content ?? "").replace(/<[^>]+>/g, " "))].join(" "),
    })),
  };
}

// Dayforce (Ceridian) is DETECTED but not read.
//
// Its board renders client-side and the listing call —
// POST /api/geo/{namespace}/jobposting/search — returns 403 without a session
// and CSRF token. That is an access control, not an oversight, so it is left
// alone: detection still records the platform and marks Dayforce as a system
// they run, and posting discovery falls back to web search exactly as it does
// for Taleo and iCIMS.
export async function fetchFeed(platform: string, a: string, b?: string): Promise<AtsFeed | null> {
  if (platform === "workday" && b) return workday(a, b);
  if (platform === "oracle" && b) return oracle(a, b);
  if (platform === "greenhouse") return greenhouse(a);
  if (platform === "lever") return lever(a);
  return null; // taleo / icims / dayforce have no readable public feed — those fall back to search
}

// Workday's list is titles-only too. The description — where the system names
// actually are — is one GET deeper, on the same cxs path.
export async function workdayDetail(tenantHost: string, site: string, externalPath: string): Promise<string> {
  const tenant = tenantHost.split(".")[0];
  const u = `https://${tenantHost}.myworkdayjobs.com/wday/cxs/${tenant}/${site}${externalPath}`;
  const r = await req(u, {}, 20000);
  if (!r?.ok) return "";
  const j: any = await r.json().catch(() => null);
  return String(j?.jobPostingInfo?.jobDescription ?? "").replace(/<[^>]+>/g, " ");
}

// Oracle's list payload carries no description, so the system names live one
// fetch deeper. Worth it: that detail text is where Maximo and PeopleSoft were.
export async function oracleDetail(host: string, site: string, id: string): Promise<string> {
  const u = `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitionDetails?expand=all&onlyData=true&finder=ById;Id=%22${id}%22,siteNumber=${site}`;
  const r = await req(u, {}, 20000);
  if (!r?.ok) return "";
  const j: any = await r.json().catch(() => null);
  const it = (j?.items ?? [])[0] ?? {};
  return [it.ExternalDescriptionStr, it.ExternalQualificationsStr, it.ExternalResponsibilitiesStr]
    .filter(Boolean).join(" ").replace(/<[^>]+>/g, " ");
}

// --------------------------------------------------------------- discovery
// Homepage -> careers link -> follow -> identify. ~25% hit rate on utility
// sites (many block bots or render nav with JS), so it is one route of
// several, not the only one.
export async function discover(website: string): Promise<{ platform: string; a: string; b?: string; url: string } | null> {
  const home = await req(`https://${website}`, {}, 12000);
  if (!home) return null;
  const finalHit = identify(home.url);
  if (finalHit) return { ...finalHit, a: finalHit.a!, url: home.url };
  const html = await home.text().catch(() => "");
  if (!html) return null;

  // Any ATS URL mentioned anywhere on the page is the cheapest win.
  const inline = html.match(/https?:\/\/[^"'\s]*(?:myworkdayjobs\.com|oraclecloud\.com\/hcmUI[^"'\s]*|boards\.greenhouse\.io|jobs\.lever\.co|jobs\.dayforcehcm\.com|taleo\.net|icims\.com)[^"'\s]*/i);
  if (inline) { const id = identify(inline[0]); if (id?.a) return { ...id, a: id.a, url: inline[0] }; }

  const links = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1])
    .filter((h) => /career|jobs|join-?us|work-with-us/i.test(h)).slice(0, 4);
  for (const l of [...links, "/careers", "/jobs"]) {
    let u: string; try { u = new URL(l, `https://${website}`).href; } catch { continue; }
    const page = await req(u, {}, 10000);
    if (!page) continue;
    const hit = identify(page.url);
    if (hit?.a) return { ...hit, a: hit.a, url: page.url };
    const body = await page.text().catch(() => "");
    const m = body.match(/https?:\/\/[^"'\s]*(?:myworkdayjobs\.com|oraclecloud\.com\/hcmUI[^"'\s]*|boards\.greenhouse\.io|jobs\.lever\.co|taleo\.net)[^"'\s]*/i);
    if (m) { const id = identify(m[0]); if (id?.a) return { ...id, a: id.a, url: m[0] }; }
  }
  return null;
}

// ------------------------------------------------------------ system scan
// Whole-word only, over posting TEXT — never the JSON keys. A naive scan
// matched "Workday" on all 72 Con Edison postings because the payload has a
// "WorkDays" field.
// ------------------------------------------------------------ system scan
// Some vendor names are ordinary English ("for the duration of the workday")
// or common acronyms, so those must appear in a SYSTEMS context to count. The
// naive version reported Workday x39 at Con Edison — every one of them that
// phrase, at a company we know runs Oracle Fusion HCM.
const CONTEXT = /(HCM|HRIS|ERP|EPM|financials?|payroll|platform|system|module|tenant|instance|suite|cloud|implementation|administrat|developer|analyst|integration|upgrade|migration)/i;

// [pattern, label, requires systems context nearby]
const VENDORS: [RegExp, string, boolean][] = [
  [/\boracle\b/i, "Oracle", true],
  [/\bSAP\b|\bS\/4\s?HANA\b|\bSuccessFactors\b/i, "SAP", true],
  // "workday" is too common as plain English for a nearby-context test to be
  // safe — "duration of the workday" sat next to "no systems experience" and
  // passed. It must be named as a product.
  [/\bworkday\s+(hcm|financials?|payroll|adaptive|prism|recruiting|studio|extend|tenant|system|platform|module|implementation|integration|reporting)\b|(experience|proficien\w+|knowledge|administer\w*|configur\w*|implement\w*)\s+(with|in|of|the)?\s*workday\b/i, "Workday", false],
  [/\bmaximo\b/i, "IBM Maximo", false],
  [/\bpeoplesoft\b/i, "PeopleSoft", false],
  [/\bhyperion\b/i, "Hyperion", false],
  [/\bprimavera\b/i, "Primavera", false],
  [/\bsalesforce\b/i, "Salesforce", false],
  [/\bitron\b/i, "Itron", false],
  [/\binformatica\b/i, "Informatica", false],
  [/oracle data integrator|\bODI\b/i, "Oracle Data Integrator", false],
  [/\bIFS\b/i, "IFS", true],
  [/\bInfor\b/i, "Infor", true],
];

const ROLE_SIGNAL = /\b(ERP|EPM|financial system|general ledger|month-end close|consolidation|capital project|procurement system|IT application|digital transformation|controller|financial analyst)\b/i;

// True only when the term sits near systems language, not merely somewhere in
// a 7,000-character posting.
function inSystemsContext(text: string, re: RegExp): boolean {
  const g = new RegExp(re.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    const window = text.slice(Math.max(0, m.index - 60), m.index + 60);
    if (CONTEXT.test(window)) return true;
  }
  return false;
}

export function scanPostings(postings: Posting[]) {
  const vendors = new Map<string, { count: number; titles: string[] }>();
  const relevant: Posting[] = [];
  for (const p of postings) {
    const hay = `${p.title} ${p.text ?? ""}`;
    for (const [re, name, needsContext] of VENDORS) {
      if (!re.test(hay)) continue;
      if (needsContext && !inSystemsContext(hay, re)) continue;
      const e = vendors.get(name) ?? { count: 0, titles: [] };
      e.count++;
      if (e.titles.length < 5 && !e.titles.includes(p.title)) e.titles.push(p.title);
      vendors.set(name, e);
    }
    if (ROLE_SIGNAL.test(hay)) relevant.push(p);
  }
  return { vendors, relevant };
}

// ---------------------------------------------------------- shared builder
// Used by BOTH the in-app hiring button and the batch loader, so an account
// researched either way ends up identical — the same mistake as letting the
// sweep carry its own copy of a prompt.
export type AtsResolution = { platform: string; a: string; b?: string; url: string };

export async function resolveAts(ent: {
  website?: string | null; ats_platform?: string | null; ats_url?: string | null;
  hiring_json?: any; stack_json?: any; profile_json?: any; priorities_json?: any;
}): Promise<AtsResolution | null> {
  if (ent.ats_url) { const id = identify(ent.ats_url); if (id?.a) return { ...id, a: id.a, url: ent.ats_url }; }
  const urls = (JSON.stringify([ent.hiring_json, ent.stack_json, ent.profile_json, ent.priorities_json]).match(/https?:\/\/[^"\ ]+/g) ?? []);
  for (const u of urls) { const id = identify(u); if (id?.a) return { ...id, a: id.a, url: u }; }
  if (ent.website) return await discover(ent.website);
  return null;
}

export async function buildHiringFromAts(companyName: string, hit: AtsResolution, detailCap = 60) {
  const feed = await fetchFeed(hit.platform, hit.a, hit.b);
  if (!feed) return null;
  const postings = feed.postings;
  if (hit.platform === "oracle" || hit.platform === "workday") {
    for (const p of postings.slice(0, detailCap)) {
      p.text = hit.platform === "oracle"
        ? await oracleDetail(hit.a, hit.b!, p._id ?? "")
        : await workdayDetail(hit.a, hit.b!, p._path ?? "");
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  const { vendors, relevant } = scanPostings(postings);
  const roles = relevant.slice(0, 8).map((p) => ({
    title: p.title,
    why: "Open role touching finance, ERP or capital-project systems — a live buying signal.",
    source: p.url,
  }));
  const vendorList = [...vendors.entries()].sort((a, b) => b[1].count - a[1].count);
  return {
    data: {
      summary:
        `${feed.total} open role${feed.total === 1 ? "" : "s"} on ${companyName}'s own careers site` +
        (roles.length ? `, ${roles.length} touching finance or systems` : ", none obviously finance/systems related") +
        (vendorList.length ? `. Postings name: ${vendorList.map(([v, d]) => `${v} (${d.count})`).join(", ")}.` : "."),
      roles,
      signal: roles.length >= 3 ? "hot" : roles.length ? "warm" : "quiet",
      source: feed.url,
      via: "ats",
      platform: hit.platform,
      openings: feed.total,
      vendors: vendorList.map(([v, d]) => ({ vendor: v, mentions: d.count, titles: d.titles })),
    },
    resolution: hit,
  };
}
