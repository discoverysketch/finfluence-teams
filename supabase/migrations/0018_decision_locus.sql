-- 0018_decision_locus.sql — who actually makes the buying decision.
-- Web-researched + human-reviewed per entity (shared directory intelligence,
-- like entity_facts): local = the company signs for itself, corporate = the
-- parent decides, mixed = depends on the purchase. Steers the pre-call brief
-- and outreach targeting.
alter table public.entities
  add column if not exists decision_locus text check (decision_locus in ('local','corporate','mixed')),
  add column if not exists decision_note text,
  add column if not exists decision_source text;
