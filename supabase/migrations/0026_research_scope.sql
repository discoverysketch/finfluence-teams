-- 0026_research_scope.sql — keep out-of-market accounts out of research runs.
--
-- A third of the book turned out not to be energy or water companies (retail,
-- steel, digital health, a blank-check SPAC — mostly bad CSV matches). Every
-- research pass was paying to research them, so the sweep and bulk actions now
-- skip anything flagged here. It's a flag, not a delete: the account stays in
-- the book and can still be researched by hand.
alter table public.accounts
  add column if not exists research_excluded boolean not null default false;

-- SEC assigns every filer an SIC industry code. Storing it makes "is this an
-- energy/water company?" a deterministic lookup instead of a judgement call,
-- and it's useful for segmenting the book later. 49xx = electric/gas/water.
alter table public.entities
  add column if not exists sic      text,
  add column if not exists sic_desc text;
