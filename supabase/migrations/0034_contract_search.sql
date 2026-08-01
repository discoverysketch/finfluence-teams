-- Ranked retrieval over the contract corpus.
--
-- This has to live in Postgres. PostgREST's text search can filter but cannot
-- order by ts_rank, so querying through the client returned matching clauses in
-- insertion order — every question came back with CSA 1.1, 1.2, 1.3 regardless
-- of what was asked.
--
-- Terms are OR'd, not AND'd. websearch_to_tsquery requires every word to be
-- present, so "limitation of liability cap" returned nothing at all: the clause
-- says "aggregate liability", never "cap". OR plus ranking degrades gracefully —
-- the more of the question a clause matches, the higher it sits.
create or replace function search_contracts(q text, k int default 12)
returns table (doc_key text, idx int, heading text, body text, rank real)
language plpgsql
stable
as $$
declare
  orq text;
  tq  tsquery;
begin
  -- "oracle" is a stopword here: it appears in nearly every clause of every
  -- document, so it costs ranking signal rather than adding it.
  select string_agg(t, ' | ') into orq
  from unnest(regexp_split_to_array(lower(regexp_replace(coalesce(q, ''), '[^a-zA-Z0-9]+', ' ', 'g')), '\s+')) as t
  where length(t) > 2
    and t not in ('the','and','for','are','can','you','our','what','does','with','from','that','this',
                  'will','how','any','all','not','use','has','was','were','they','their','its','own',
                  'may','must','should','have','been','when','who','why','oracle','under','into','than','then');

  if orq is null or orq = '' then
    return;
  end if;

  tq := to_tsquery('english', orq);

  -- Document weighting. A negotiation question is answered by the agreement,
  -- the pillar document and the policies; the Fusion service descriptions are
  -- 452k characters of SKU copy that mention every term and settle nothing, so
  -- they are damped rather than excluded.
  return query
  select c.doc_key, c.idx, c.heading, c.body,
         (ts_rank(c.tsv, tq) * case c.doc_key
            when 'csa'                  then 1.6
            when 'pillar_saas'          then 1.5
            when 'dpa'                  then 1.4
            when 'ai_terms'             then 1.4
            when 'hosting_delivery'     then 1.3
            when 'security_practices'   then 1.1
            when 'fusion_prof_services' then 1.0
            else 0.7
          end)::real as rank
  from contract_chunks c
  where c.tsv @@ tq
  order by rank desc, c.doc_key, c.idx
  limit greatest(1, least(k, 40));
end;
$$;

grant execute on function search_contracts(text, int) to authenticated;
