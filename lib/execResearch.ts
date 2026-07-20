import Anthropic from "@anthropic-ai/sdk";

// Web-research an entity's current leadership from public sources (company
// leadership pages, press releases). Names/titles/source URLs only — never
// scraped personal contact details. Search locates the leadership page; FETCH
// reads the full roster (search snippets alone usually only surface the CEO).
// Shared by the Hub's manual "Find executives" and the background research that
// runs when an account is added.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type FoundExec = { name: string; title: string; suggested_role: string; source_url: string };

const ROLES = ["economic_buyer", "champion", "exec_sponsor", "influencer", "end_user", "blocker", ""] as const;
const SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    executives: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          name: { type: "string" },
          title: { type: "string" },
          suggested_role: { type: "string", enum: [...ROLES] },
          source_url: { type: "string" },
        },
        required: ["name", "title", "suggested_role", "source_url"],
      },
    },
  },
  required: ["executives"],
};

export async function researchExecutives(name: string, hqState?: string | null): Promise<FoundExec[]> {
  const client = new Anthropic();
  const research = await client.messages.create({
    model: "claude-sonnet-5", max_tokens: 9000,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 2 } as any,
      { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 } as any,
    ],
    messages: [{
      role: "user",
      content:
        `Find the CURRENT senior leadership of ${name}${hqState ? ` (${hqState})` : ""}, a US utility/energy company. ` +
        `Method: ONE search like "${name} leadership team executives" to locate the company's own leadership/team page, then FETCH that page and read the FULL roster (don't stop at the CEO from search snippets). Fetch a second page (e.g. a press release) only if needed. ` +
        `Wanted: CEO, CFO, and the leaders relevant to an enterprise-software sale — CIO/CTO, VP/SVP Finance, Treasurer, COO, VP Supply Chain, chief customer/digital/development officers. Up to ~10 people. ` +
        `For each: full name, exact title, and the URL of the page you read them on. ` +
        `ONLY people you actually saw on a fetched page or in results; skip uncertain entries. Compact list.`,
    }],
  });
  const notes = research.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("\n").trim();
  if (!notes) throw new Error("Research came back empty — try again, or add people manually.");

  const extract = await client.messages.create({
    model: "claude-sonnet-5", max_tokens: 3000,
    output_config: { format: { type: "json_schema", schema: SCHEMA } } as any,
    system:
      "Extract the executives from the research notes. ONLY people with a source URL in the notes — drop the rest. " +
      "suggested_role (deal-role guess a rep can edit): CFO/Treasurer/VP Finance -> economic_buyer; CEO/President -> exec_sponsor; " +
      "CIO/CTO/COO/VP-level operators -> influencer; otherwise \"\". No duplicates; dedupe people listed twice.",
    messages: [{ role: "user", content: `Company: ${name}\n\nResearch notes:\n${notes.slice(0, 16000)}` }],
  });
  const text = extract.content.filter((b) => b.type === "text").map((b) => (b as any).text).join("");
  return ((JSON.parse(text).executives ?? []) as FoundExec[])
    .filter((e) => e.name && /^https?:\/\//.test(e.source_url)).slice(0, 12);
}
