// Batch research sweep over the book. Uses lib/researchTasks.ts — the SAME
// prompts, schemas and tool budgets as the in-app buttons — so an account
// researched by this sweep is indistinguishable from one researched by hand.
//
//   node --env-file=.env.local --experimental-strip-types seed/research-book.ts [ceilingUSD] [--dry]
//
// Safe to re-run: anything already researched is skipped, so a crash or an
// early stop never re-bills work that already landed.
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { runTask, costOf, type TaskKey, type Ent } from "../lib/researchTasks.ts";
import { fetchProxy, fetchLeadershipDocs, fetchRiskFactors } from "../lib/proxy.ts";
import { commissionsFor } from "../lib/dockets.ts";
import { withRetry } from "../lib/aiRetry.ts";
/* eslint-disable @typescript-eslint/no-explicit-any */

const CEILING = Number(process.argv[2]) || 45;
const DRY = process.argv.includes("--dry");
// Concurrency 2, not 4: four parallel long requests hit the rate limit often
// enough that retries were costing more time than the extra workers saved.
const CONCURRENCY = 2;
// --tasks=comp,hiring,decision — priorities is excluded by default: it's the
// priciest facet (~$0.70) and goes stale fastest, so it's opt-in.
const ALL: TaskKey[] = ["comp", "hiring", "decision", "priorities", "risks", "dockets"];
const arg = process.argv.find((a) => a.startsWith("--tasks="));
const TASKS: TaskKey[] = arg
  ? (arg.split("=")[1].split(",").filter((t) => (ALL as string[]).includes(t)) as TaskKey[])
  : ["comp", "hiring", "decision"];

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const client = new Anthropic();

const { data: accts } = await db.from("accounts")
  .select("entity:entities(id, canonical_name, ticker, cik, hiring_json, comp_json, priorities_json, risks_json, dockets_json, decision_locus)");
const ents = [...new Map((accts ?? []).filter((a: any) => a.entity).map((a: any) => [a.entity.id, a.entity])).values()] as any[];

// Publicly traded only — the scope chosen for this sweep.
const listed = ents.filter((e) => e.ticker && e.cik);
const has: Record<TaskKey, (e: any) => boolean> = {
  comp: (e) => !!e.comp_json, decision: (e) => !!e.decision_locus,
  hiring: (e) => !!e.hiring_json, priorities: (e) => !!e.priorities_json,
  risks: (e) => !!e.risks_json, dockets: (e) => !!e.dockets_json,
};

type Job = { ent: Ent; task: TaskKey };
const jobs: Job[] = [];
for (const t of TASKS) for (const e of listed) if (!has[t](e)) jobs.push({ ent: e, task: t });

const byTask = TASKS.map((t) => `${t} ${jobs.filter((j) => j.task === t).length}`).join(" · ");
console.log(`publicly traded companies: ${listed.length} of ${ents.length}`);
console.log(`jobs to run: ${jobs.length}  (${byTask})`);
console.log(`spend ceiling: $${CEILING.toFixed(2)} · concurrency ${CONCURRENCY}${DRY ? " · DRY RUN (no API calls, nothing written)" : ""}\n`);
if (DRY || !jobs.length) process.exit(0);

let spent = 0, done = 0, failed = 0, stopped = false;
const started = Date.now();
const fails: string[] = [];

async function save(task: TaskKey, ent: Ent, data: any) {
  const now = new Date().toISOString();
  if (task === "hiring") return db.from("entities").update({ hiring_json: data, hiring_at: now }).eq("id", ent.id);
  if (task === "priorities") return db.from("entities").update({ priorities_json: data, priorities_at: now }).eq("id", ent.id);
  if (task === "risks") return db.from("entities").update({ risks_json: data, risks_at: now }).eq("id", ent.id);
  if (task === "dockets") return db.from("entities").update({ dockets_json: data, dockets_at: now }).eq("id", ent.id);
  if (task === "comp") {
    const upd: any = { comp_json: data, comp_at: now };
    if (Number.isInteger(data.employees) && data.employees > 0) upd.employees = data.employees;
    return db.from("entities").update(upd).eq("id", ent.id);
  }
  return db.from("entities").update({
    decision_locus: data.locus,
    decision_note: String(data.note || "").slice(0, 500) || null,
    decision_source: String(data.source_url || "").slice(0, 400) || null,
    decision_at: now,
  }).eq("id", ent.id);
}

const queue = [...jobs];
async function worker(id: number) {
  while (queue.length && !stopped) {
    if (spent >= CEILING) { stopped = true; console.log(`\n!! spend ceiling $${CEILING.toFixed(2)} reached — stopping. Re-run to continue.`); break; }
    const job = queue.shift();
    if (!job) break;
    const label = `${job.task}/${job.ent.canonical_name.slice(0, 26)}`;
    try {
      const { data, usage } = await withRetry(() => runTask(client, job.ent, job.task, fetchProxy, fetchLeadershipDocs, undefined, fetchRiskFactors, commissionsFor(job.ent.canonical_name, job.ent.hq_state)), 4);
      // Same guard the priorities route applies: a priority without a source is dropped.
      if (job.task === "priorities") {
        data.priorities = (data.priorities ?? []).filter((p: any) => /^https?:\/\//.test(p.source)).slice(0, 8);
        if (!data.priorities.length) throw new Error("no citable priorities found");
      }
      if (job.task === "dockets") {
        data.cases = (data.cases ?? []).filter((c: any) => /^https?:\/\//.test(c.source)).slice(0, 3);
        if (!data.cases.length) throw new Error("no citable rate case found");
      }
      if (job.task === "risks") {
        data.risks = (data.risks ?? []).filter((r: any) => /^https?:\/\//.test(r.source)).slice(0, 8);
        if (!data.risks.length) throw new Error("no actionable risk factors found");
      }
      const c = costOf(usage);
      spent += c;
      const { error } = await save(job.task, job.ent, data);
      if (error) throw new Error(`save failed: ${error.message}`);
      done++;
      console.log(`[${String(done + failed).padStart(3)}/${jobs.length}] ✓ ${label.padEnd(34)} $${c.toFixed(3)}  running $${spent.toFixed(2)}`);
    } catch (e: any) {
      failed++; fails.push(`${label}: ${e.message}`);
      console.log(`[${String(done + failed).padStart(3)}/${jobs.length}] ✗ ${label.padEnd(34)} ${String(e.message).slice(0, 60)}`);
    }
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

const mins = (Date.now() - started) / 60000;
console.log(`\n=== done: ${done} researched · ${failed} failed · $${spent.toFixed(2)} · ${mins.toFixed(0)} min ===`);
if (queue.length) console.log(`${queue.length} job(s) left unrun — re-run this script to continue.`);
if (fails.length) { console.log("\nfailures:"); for (const f of fails.slice(0, 20)) console.log(`  ${f}`); }
