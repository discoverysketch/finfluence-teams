-- Fix: reps type tickers (e.g. "AEP"), not company names. Match on ticker exactly
-- (case-insensitive, scored as a perfect hit) OR fuzzy name — whichever is better.
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
         greatest(
           similarity(e.canonical_name, q),
           case when e.ticker is not null and upper(e.ticker) = upper(trim(q)) then 1.0 else 0 end
         ) as score
  from public.entities e
  where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
    and (e.canonical_name % q or (e.ticker is not null and upper(e.ticker) = upper(trim(q))))
  order by score desc
  limit greatest(1, least(lim, 12));
$$;
