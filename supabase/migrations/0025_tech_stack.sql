-- 0025_tech_stack.sql — competitive battlecard: what the account appears to
-- run today (SAP / Workday / IFS / Maximo / legacy), inferred from PUBLIC
-- tells only — job postings naming systems, 10-K technology discussion,
-- vendor press releases and case studies, conference talks.
--
-- Cached on the shared entity like the other deep-intel facets, so one rep's
-- research serves the whole team. Covered by the existing entities RLS.
alter table public.entities
  add column if not exists stack_json jsonb,
  add column if not exists stack_at   timestamptz;
