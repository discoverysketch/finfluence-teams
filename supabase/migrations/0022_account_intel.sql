-- 0022_account_intel.sql — deeper public-data enrichment on the shared entity.
-- hiring: open finance/ERP/systems roles (buying-intent signal).
-- comp: exec-compensation metrics from the DEF 14A proxy (what leadership is
--   paid to hit). employees: real headcount (grounds the license estimator).
-- fleet: generation fleet summary. muni: financial snapshot for non-SEC munis.
alter table public.entities
  add column if not exists hiring_json jsonb,
  add column if not exists hiring_at timestamptz,
  add column if not exists comp_json jsonb,
  add column if not exists comp_at timestamptz,
  add column if not exists employees integer,
  add column if not exists fleet_json jsonb,
  add column if not exists fleet_at timestamptz,
  add column if not exists muni_json jsonb,
  add column if not exists muni_at timestamptz;
