-- word_similarity on OFFICIAL names over-matched generic word overlaps
-- ("Apx Parent Holdco" -> "CID Holdco, Inc." 73%). Aliases are specific, so keep
-- word_similarity there (that's where Vectren/Luminant/Acme wins come from) and
-- return official-name matching to plain trigram similarity.
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
             case when length(a.alias) >= 6 then word_similarity(a.alias, q) else 0 end,
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
