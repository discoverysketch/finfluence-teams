-- Subsidiary/brand/former-name matching: "NYSEG", "Duracell", "Vistra Energy"
-- resolve to their SEC-registered parents via entity_aliases (table + trigram
-- index existed since 0001/0004 but were unused).

-- Allow curated alias rows (seeded by seed/seed-aliases.ts).
alter table public.entity_aliases drop constraint if exists entity_aliases_source_check;
alter table public.entity_aliases add constraint entity_aliases_source_check
  check (source in ('user','gleif','sec','eia','curated'));

-- Return type gains matched_alias, so drop + recreate (same call signature).
drop function if exists public.match_entities(text, int);
create function public.match_entities(q text, lim int default 6)
returns table (
  id uuid, canonical_name text, ticker text, cik text,
  entity_type text, data_tier text, hq_state text, score real, matched_alias text
)
language sql stable
security invoker
set search_path = public
as $$
  with hits as (
    -- fuzzy on official name
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           similarity(e.canonical_name, q) as score, null::text as matched_alias
    from public.entities e
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and e.canonical_name % q
    union all
    -- exact ticker / stored acronym
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           1.0, null::text
    from public.entities e
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and e.ticker is not null and upper(e.ticker) = upper(trim(q))
    union all
    -- aliases: subsidiaries, brands, former names, abbreviations
    select e.id, e.canonical_name, e.ticker, e.cik, e.entity_type, e.data_tier, e.hq_state,
           greatest(similarity(a.alias, q),
                    case when upper(a.alias) = upper(trim(q)) then 1.0 else 0 end),
           a.alias
    from public.entity_aliases a
    join public.entities e on e.id = a.entity_id
    where (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())
      and (a.alias % q or upper(a.alias) = upper(trim(q)))
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
