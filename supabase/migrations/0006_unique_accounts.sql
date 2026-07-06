-- Duplicate protection: one account row per entity per list.
-- 1) Remove any duplicates that already exist (keep the oldest row of each pair).
delete from public.accounts a
using public.accounts b
where a.list_id = b.list_id
  and a.entity_id is not null
  and a.entity_id = b.entity_id
  and a.id > b.id;

-- 2) Enforce it going forward (partial: entity-less rows are unconstrained).
create unique index if not exists accounts_list_entity_uniq
  on public.accounts (list_id, entity_id)
  where entity_id is not null;
