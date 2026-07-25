-- 0027_inferred_read.sql — an informed read for companies with no public filings.
--
-- Private developers, munis and co-ops file nothing, so comp/priorities/
-- decision research returns empty and a rep walks in with nothing at all.
-- This holds a PATTERN-level read for those accounts: what is typical for a
-- company of this type, why it applies here, and the question to ask to
-- confirm it.
--
-- Deliberately stored in its own column, never merged into the sourced facets:
-- inferred content must never be able to render as if it came from a filing.
alter table public.entities
  add column if not exists inferred_json jsonb,
  add column if not exists inferred_at   timestamptz;
