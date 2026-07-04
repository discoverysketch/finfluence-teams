# CLAUDE.md — FinFluency Teams stack conventions

This repo is evolving from a single-file PWA (`index.html`, live at finfluence-xi.vercel.app)
into **FinFluency Teams**, a multi-tenant sales-enablement product. The full product spec is
[SPEC.md](SPEC.md). Build **phase-by-phase per SPEC §9** and gate each phase on its exit test
before starting the next. This file holds durable stack + coding conventions.

## Current state
- The live product is a single self-contained `index.html` PWA + `api/financials.js` (SEC EDGAR
  proxy) deployed as a static site on Vercel. It stays live and is the reference for flows and
  content until the Phase 1 migration reaches parity — do not break it while building Teams.

## Stack (SPEC §2)
- **Framework:** Next.js (App Router) + TypeScript on Vercel.
- **DB / Auth:** Supabase — Postgres + Auth + Row-Level Security. Magic-link auth for MVP;
  design the `users` table for SSO later (WorkOS/SAML, Phase 4+).
- **AI:** Anthropic API for card/question generation, entity disambiguation, CFO simulation,
  and narratives. SPEC names `claude-sonnet-4-6`; **confirm the current model id against the
  claude-api reference before wiring** (the current Sonnet is likely `claude-sonnet-5`).
- **Charts:** Recharts. Keep visuals boring and legible.
- **PWA:** preserve offline behavior — DB is the source of truth; localStorage is an offline
  cache that syncs on reconnect.

## Non-negotiable rules
- **RLS before UI.** Write and test row-level-security policies for every tenant-scoped table
  before building any screen against it. All tables are tenant-scoped **except** the shared
  entity directory (`entities` rows where `created_by_tenant IS NULL`).
- **Every fact carries `source_url`.** No source → render as "unverified." Comparison tables
  show dashes, never fabricated numbers. This "verify against filings" ethos is non-negotiable.
- **Human-in-the-loop AI.** Claude drafts cards/questions/profiles; an admin approves before
  publish. Never auto-publish AI-generated content.
- **Concept tags unify learning + planning.** Cards and Challenge questions emit the same
  `concept_tag`; that yields one acumen score per rep per concept for the dashboard heatmap.
- **Parent/subsidiary links matter** (Berkshire → MidAmerican → PacifiCorp). Comparisons and
  Challenge questions must work at both the parent and subsidiary level.
- **Cost control:** directory loads are one-time batch jobs. Call Claude only at match-time,
  profile generation, card/question generation, and narratives. Cache aggressively in
  `entity_facts`.

## Data availability tiers (SPEC §4) — the UI is honest about tier
- **A** SEC filers (EDGAR) — full Challenge + comparisons
- **B** FERC/EIA private utilities & subs (FERC Form 1, EIA-861/860/923) — utility-metric Challenge
- **C** munis / co-ops with bond issues (EMMA + EIA) — basic metrics + bond disclosures
- **D** true private (Claude web-researched profile + user estimates, clearly labeled)

## Secrets / env (never commit)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`ANTHROPIC_API_KEY`. Store in Vercel + a local `.env.local` (gitignored).

## Workflow discipline
- Work SPEC §9 phases in order; do not start a phase before the prior phase's exit test passes.
- Migrations are the source of truth for schema; keep RLS policies alongside them.
