import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic();
const focus = "Oracle Primavera P6, Aconex, and Oracle Cloud ERP for capital projects";
const research = await client.messages.create({
  model: "claude-sonnet-5", max_tokens: 3000,
  tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
  messages: [{ role: "user", content: `Find 4 REAL, citable customer success stories where UTILITY, ENERGY, or WATER companies (IOUs, municipals, co-ops, water districts, grid operators — any country, prefer US) used ${focus}. Prefer oracle.com/customers case studies and official press releases. For each: customer name; Oracle product(s); what they deployed; concrete outcomes with numbers where published; EXACT source URL. Only include stories you can cite with a working URL. Plain compact notes, one story per paragraph.` }],
});
const notes = research.content.filter(b=>b.type==="text").map(b=>b.text).join("\n").trim();
const SCHEMA={type:"object",additionalProperties:false,properties:{cards:{type:"array",items:{type:"object",additionalProperties:false,properties:{front:{type:"string"},concept_tag:{type:"string",enum:["prof","liq","ret","cash","found"]},prompt:{type:"string"},whatItIs:{type:"string"},whyItMatters:{type:"string"},link:{type:"string"},utility:{type:"string"},worked:{type:"string"}},required:["front","concept_tag","prompt","whatItIs","whyItMatters","link","utility","worked"]}}},required:["cards"]};
const ex = await client.messages.create({ model:"claude-opus-4-8", max_tokens:4000, output_config:{format:{type:"json_schema",schema:SCHEMA}},
  system:"Turn each sourced customer story into ONE flashcard for utility-focused sales reps. ONLY facts from the notes. front='Customer — product'. worked ends with 'Source: <url>'. Drop unsourced stories.",
  messages:[{role:"user",content:`Research notes:\n\n${notes.slice(0,20000)}`}] });
const cards = JSON.parse(ex.content.filter(b=>b.type==="text").map(b=>b.text).join("")).cards;
console.log(`${cards.length} cards:`);
for (const c of cards) console.log(`\n■ ${c.front}\n  ${c.whyItMatters.slice(0,150)}\n  ${c.worked.slice(-90)}`);
