-- 0019_deal_value.sql — dollars on the pipeline.
-- deal_value: the rep's estimate of the opportunity ($). Drives $-per-stage and
-- weighted-pipeline math on the manager dashboard and the Monday digest.
alter table public.accounts
  add column if not exists deal_value numeric;
