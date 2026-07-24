-- 0020_leadership_intel.sql — public-source leadership intelligence.
-- priorities_json: management's OWN stated priorities from earnings calls +
-- 10-K/8-K filings (shared directory intel, like entity_facts/decision_locus).
-- persona_json (on contacts): a researched public persona brief for an exec,
-- shown when you flip their org-chart node.
alter table public.entities
  add column if not exists priorities_json jsonb,
  add column if not exists priorities_at timestamptz;

alter table public.contacts
  add column if not exists persona_json jsonb;
