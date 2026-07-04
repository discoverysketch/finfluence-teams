-- Phase 5: fuzzy entity matching for account intake.
create extension if not exists pg_trgm;

create index if not exists entities_name_trgm on public.entities using gin (canonical_name gin_trgm_ops);
create index if not exists aliases_alias_trgm on public.entity_aliases using gin (alias gin_trgm_ops);

-- Unique CIK lets the SEC directory loader upsert idempotently.
-- (Multiple NULLs are allowed, so tenant-private entities without a CIK are unaffected.)
create unique index if not exists entities_cik_uniq on public.entities (cik);

-- Fuzzy name match against the shared directory + the caller's own entities.
-- security invoker => the entities RLS policy still applies; the WHERE mirrors it.
create or replace function public.match_entities(q text, lim int default 6)
returns table (
  id uuid, canonical_name text, ticker text, cik text,
  entity_type text, data_tier text, hq_state text, score real
)
language sql stable
security invoker
set search_path = public
as $$
  select e.id, e.canonical_name, e.ticker, e.cik,
         e.entity_type, e.data_tier, e.hq_state,
         similarity(e.canonical_name, q) as score
  from public.entities e
  where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
    and e.canonical_name % q
  order by similarity(e.canonical_name, q) desc
  limit greatest(1, least(lim, 12));
$$;
