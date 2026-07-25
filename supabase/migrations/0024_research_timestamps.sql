-- 0024_research_timestamps.sql — "when was this last researched?"
-- Deep intel and priorities already stamp *_at (hiring_at, comp_at, fleet_at,
-- muni_at, priorities_at). These three research surfaces never did, so the UI
-- had no way to tell a rep whether a persona brief was pulled yesterday or a
-- year ago. Covered by the existing entities / contacts RLS policies.
alter table public.entities
  add column if not exists decision_at timestamptz,
  add column if not exists profile_at  timestamptz;

alter table public.contacts
  add column if not exists persona_at timestamptz;

-- No backfill: existing rows were researched at an unknown time, and stamping
-- them "now" would claim freshness they haven't got. They render as
-- "date unknown" until the next re-run, which is the honest state.
