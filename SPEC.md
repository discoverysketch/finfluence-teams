# FinFluency Teams — Complete Build Spec (SPEC.md)
**Goal:** Evolve the single-user FinFluency PWA (finfluence-xi.vercel.app) into a multi-tenant sales-enablement product with team dashboards, configurable content packs, an expanded Company Challenge, entity resolution for public AND private accounts, lookalike discovery, and territory planning around the finance stream. Flashcards remain a first-class feature.
**How to use this file:** keep it in the repo root as `SPEC.md`. Work phase-by-phase (§9). Keep a separate `CLAUDE.md` for stack conventions. Gate each phase on its exit test before moving on.
---
## 1. Product shape
Three roles, one app:
| Role | What they see |
|---|---|
| **Rep** | Learning path (flashcards), Company Challenge, Vault, Territory Board, personal stats |
| **Manager** | Everything a rep sees + team dashboard (completion, scores, streaks, weak topics) + roster Territory Board |
| **Admin (enablement)** | Everything + content pack editor, roster management, account assignments, branding |
**Display modes (per-tenant toggle):**
- *Playful:* Finn the wizard, XP, levels, streaks (current app)
- *Professional:* same mechanics relabeled — "Financial Acumen Certification," certification tiers, acumen score. Same data, enterprise-friendly skin for buyers.
---
## 2. Tech stack
- **Framework:** Next.js (App Router) on Vercel — migrate the current SPA into it
- **DB:** Postgres via Supabase (auth + row-level security for tenancy)
- **Auth:** Supabase Auth, email magic link for MVP; design user table for SSO later (SAML via WorkOS, Phase 4+)
- **AI:** Anthropic API (claude-sonnet-4-6) for card generation, question generation, entity disambiguation, CFO simulation, comparison narratives
- **Financial data:** SEC EDGAR company facts API (existing) + FERC Form 1 + EIA-861/860/923 + EMMA (MSRB) — all cached in DB
- **Entity resolution:** SEC company_tickers.json, GLEIF LEI API, EIA utility directory, FERC respondent list
- **State:** migrate localStorage progress → DB; keep localStorage as offline cache with sync-on-reconnect (preserve PWA behavior)
- **Charts:** Recharts. Keep it boring.
---
## 3. Data model (Postgres, all tables tenant-scoped via RLS unless noted)
```
tenants         id, name, display_mode (playful|professional), branding_json
users           id, tenant_id, email, role (rep|manager|admin), manager_id
content_packs   id, tenant_id, name, description, is_default
units           id, pack_id, title, order, icon
cards           id, unit_id, type (flashcard|quiz|swipe), front, back,
                options_json, correct_index, explanation, concept_tag
-- Entity layer (shared directory rows have created_by_tenant = null; NOT tenant-scoped)
entities        id, canonical_name, entity_type (iou|ipp|coop|muni|retailer|other),
                cik, lei, ferc_respondent_id, eia_utility_id, ticker,
                parent_entity_id, hq_state, data_tier (A|B|C|D),
                profile_json (Claude-researched summary, sourced),
                created_by_tenant (null = shared directory)
entity_aliases  entity_id, alias, source (user|gleif|sec|eia)
entity_facts    entity_id, source (sec|ferc|eia|emma|user), fact_key,
                period, value, unit, fetched_at, source_url
-- Territory layer (tenant-scoped)
account_lists   id, tenant_id, name (e.g. "Greg — FY27 territory")
accounts        id, list_id, entity_id, rep_notes, tier_override,
                crm_stage, custom_fields_json
assignments     user_id, account_list_id
-- Learning layer
progress        user_id, card_id, status, ease, due_at, streak_data
challenge_runs  id, user_id, mode, entity_ids, score, duration,
                questions_json, created_at
score_events    user_id, concept_tag, correct (bool), difficulty, source_mode, created_at
```
Key rules:
- Write RLS policies **before** building UI.
- **Parent/subsidiary links matter** (e.g., Berkshire → MidAmerican → PacifiCorp). Comparisons and Challenge questions must work at both levels.
- Shared-directory entities improve as tenants confirm matches — that's the long-term moat. Tenant-created private entities stay tenant-scoped.
- Every fact carries `source_url`; the app's "verify against filings" ethos is non-negotiable. No source → renders as "unverified."
---
## 4. Data availability tiers ("private ≠ no data" in utilities)
Every entity gets a tier; the UI is honest about it:
| Tier | Who | Sources | What works |
|---|---|---|---|
| **A** | SEC filers (public + private cos with registered debt) | EDGAR | Full Challenge, full comparisons |
| **B** | FERC/EIA-covered private utilities & subsidiaries | FERC Form 1, EIA-861/860/923 | Utility-metric Challenge: rate base, O&M, customer growth, revenue/customer, fuel mix |
| **C** | Munis & co-ops with bond issues | EMMA official statements + EIA | Basic metrics + bond disclosures |
| **D** | True private (IPPs, retailers, etc.) | Claude web-researched profile + user-entered estimates | Profile, qualitative comparison; estimates clearly labeled |
Note: FERC Form 1 rate base and O&M detail is often *better* CFO-conversation material than a 10-K. Comparison tables show dashes, never fabrications, where data doesn't exist.
---
## 5. Flashcards (keep and improve)
1. **Spaced repetition:** light SM-2 scheduler (ease factor + due_at per card). Reps keep seeing weak cards; managers see per-topic weakness.
2. **Concept tags unify everything:** every card tagged (`rate_base`, `ffo`, `working_capital`, ...). Challenge questions emit the same tags → one acumen score per rep per concept → dashboard heatmap.
3. **AI card generation in the editor:** admin pastes a source doc (primer, 10-K section, product sheet) → Claude drafts cards with explanations → admin approves/edits. Human-in-the-loop; never auto-publish.
---
## 6. Company Challenge — five modes
All modes emit `score_events (concept_tag, correct?, difficulty)`.
**6a. Peer Duel (hero mode).** Rep's account vs. a named peer (auto-suggested by the lookalike engine, §7). Relative-judgment questions ("Which carries more leverage? By roughly how much?"). Ends with a Claude-generated one-paragraph *talk track* the rep could use with the CFO.
**6b. Earnings Pulse.** Within 48h of an account filing, generate a 5-question pulse round from the new data. PWA push: "NextEra just reported — take the pulse." Timeliness → habit → retention.
**6c. CFO Simulator.** Claude role-plays the CFO of the rep's actual account, grounded in cached entity_facts. CFO asks the rep questions; Claude scores accuracy + business relevance and coaches. Persona + rubric templates live in the content pack so admins can tune. Demo-day feature — nothing on the market does account-specific CFO rehearsal.
**6d. Metric Detective.** Anonymized financials shown → rep guesses which of their accounts it is. Cheap (reuses fact cache), builds territory pattern recognition.
**6e. League.** Weekly leaderboard scoped to a manager's roster. Score = challenge points × streak multiplier; seasons reset quarterly to match sales cadence. Professional mode: "Acumen Rankings."
---
## 7. Territory Intelligence
### 7a. Account intake & matching
UX: rep pastes names or uploads CSV → match card per name → confirm/correct → confirmed matches feed learning + planning.
Pipeline per name:
1. **Normalize** — strip Inc/LLC/Corp; expand utility abbreviations (Pwr, Elec, Coop).
2. **Candidate search (deterministic, cheap):** SEC company_tickers.json + EDGAR company search; GLEIF LEI fuzzy search; EIA-861 directory (loaded to DB, pg_trgm index); FERC respondent list; existing shared directory.
3. **Claude disambiguation** — only for ambiguous names: name + rep context (industry, state) + candidates → ranked matches with confidence + one-line rationale.
4. **Match card UI** — top match + confidence, alternatives, "none of these — create private profile."
5. **Tier D fallback** — Claude (with web search tool via API) drafts a sourced profile: ownership, est. size, segment, recent news. Rep reviews before save.
### 7b. Lookalike engine ("find accounts like this")
Feature vector per entity from entity_facts: size (revenue, customers, MW), mix (revenue by class, fuel mix, regulated vs. merchant), financial posture (leverage, capex/revenue, rate-base growth), structure (entity_type, parent status, region). Similarity = normalized weighted distance within entity_type first; plain math, no embeddings needed. Claude writes the "why these are similar" narrative on top.
Applications:
1. **Peer set builder** → feeds Peer Duel and CFO Simulator
2. **Reference finder** — "accounts like X where we won" (uses crm_stage/win flag)
3. **Whitespace** — directory entities resembling my best accounts but unassigned → prospecting list
### 7c. Territory Board (planning around the finance stream)
- **Signal-based tiering:** score accounts on capex program size/growth (FERC/PUC/10-K), M&A activity, rate case activity, revenue growth, leverage headroom. Per-tenant weight sliders. Output: suggested A/B/C tiers with the *why* shown.
- **Buying-signal feed:** new 10-K/Q, FERC filing, rate case docket, bond issuance, announced ERP/IT program → surfaced as cards with talk tracks.
- **Comparison workbench:** any 2–4 entities (any tier) → side-by-side table + charts + Claude-drafted narrative ("what I'd say to the CFO about how they compare to peers").
- **Plan export:** one-click account plan doc assembling profile, peer set, signals, weak-concept flags, suggested plays.
**The differentiating loop:** planning data feeds learning (Challenge questions about the rep's real tiers/peers) and learning feeds planning (rep weak on concepts their top accounts care about → assigned cards). ZoomInfo does data, Highspot does learning; nobody closes this loop.
---
## 8. Manager dashboard
MVP widgets: team completion % by unit; last-7-day actives; concept heatmap (reps × concepts, red/yellow/green); Challenge leaderboard + trend; per-rep drill-in (streak, weak concepts, CFO Simulator transcripts with per-tenant consent flag); CSV export.
---
## 9. Build phases & exit tests
**Phase 1 — Foundation (migrate, don't rewrite)**
- Port SPA into Next.js; current single-user experience works unchanged
- Supabase auth + full schema (§3 including entity tables) + RLS
- localStorage → DB migration with offline sync
- ✅ *Exit:* existing flows work logged-in across two devices
**Phase 2 — Tenancy & roster**
- Tenants/roles, roster CSV upload, account lists & assignments
- Content pack editor v1 (CRUD units/cards) + AI card generation
- ✅ *Exit:* two tenants with fully isolated content and users
**Phase 3 — Challenge expansion**
- Concept tagging, score_events, unified fact cache
- Ship Peer Duel (manual peer pick for now) + Metric Detective + League first (no LLM cost)
- Then CFO Simulator + Earnings Pulse
- ✅ *Exit:* a full duel produces a talk track and score events
**Phase 4 — Dashboard & polish**
- Manager dashboard, CSV export, professional display mode
- SSO groundwork, PWA notifications for Earnings Pulse
- ✅ *Exit:* manager answers "who on my team is CFO-ready?" in <60 seconds
**Phase 5 — Entity resolution & directory**
- Batch-load EIA-861, FERC respondent, SEC ticker directories
- Matching pipeline + match cards + CSV intake
- entity_facts ingestion order: EDGAR (exists) → FERC Form 1 (start with 2021+ XBRL filings; don't block on pre-2021) → EIA → EMMA
- Tier D Claude profile flow
- ✅ *Exit:* 20 real account names (mixed IOU/IPP/co-op/retailer) → ≥16 auto-match; rest resolve in ≤2 clicks
**Phase 6 — Lookalikes & planning**
- Feature vectors + peer set builder (wire into Peer Duel immediately)
- Comparison workbench → Territory Board with signal tiering → buying-signal feed → plan export
- ✅ *Exit:* rep enters full book incl. private names; manager uses Territory Board for FY planning
**Cost control:** directory loads are one-time batch jobs. Claude calls only at match-time, profile generation, card/question generation, and narratives. Cache aggressively in entity_facts.
---
## 10. Validation gates
After Phase 2: pilot with nine reps for 30 days. Success metrics:
- Voluntary weekly active rate >60% without repeat prompting
- Concept heatmap deltas improving
- At least one Peer Duel talk track used in a real meeting
After Phase 6: the test is whether reps enter their *whole book* (not just public names) and managers use the Territory Board in FY planning. If both happen, Territory Intelligence is the product and flashcards are the on-ramp. That pilot data is the pitch to the first external enablement buyer.
