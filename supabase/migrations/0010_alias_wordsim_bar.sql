-- Harden alias word-similarity: only count near-exact embeddings (>=0.85).
-- Below that, aliases with generic tails ("NV Energy") partial-match anything
-- sharing a word ("Hudson Energy" at ~0.70) and pollute candidate ranking.
-- The client already compensates by down-ranking weak alias hits; this makes the
-- DB itself return sane ordering (seed scripts and future callers benefit).
create or replace function public.match_entities(q text, lim int default 6)
returns table (
  id uuid, canonical_name text, ticker text, cik text,
  entity_type text, data_tier text, hq_state text, score real, matched_alias text
)
language sql stable
security invoker
set search_path = public
as $$
  with hits as (
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           similarity(e.canonical_name, q) as score, null::text as matched_alias
    from public.entities e
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and e.canonical_name % q
    union all
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           1.0, null::text
    from public.entities e
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and e.ticker is not null and upper(e.ticker) = upper(trim(q))
    union all
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           greatest(
             similarity(a.alias, q),
             case when length(a.alias) >= 6 and word_similarity(a.alias, q) >= 0.85
                  then word_similarity(a.alias, q) else 0 end,
             case when upper(a.alias) = upper(trim(q)) then 1.0 else 0 end
           ),
           a.alias
    from public.entity_aliases a
    join public.entities e on e.id = a.entity_id
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and (a.alias % q or upper(a.alias) = upper(trim(q)) or (length(a.alias) >= 6 and a.alias <% q))
  )
  select * from (
    select distinct on (id) id, canonical_name, ticker, cik, entity_type, data_tier, hq_state, score, matched_alias
    from hits
    order by id, score desc
  ) best
  order by score desc
  limit greatest(1, least(lim, 12));
$$;

notify pgrst, 'reload schema';
