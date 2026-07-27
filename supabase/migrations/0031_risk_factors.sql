-- 10-K Item 1A risk factors, cached on the shared entity like every other
-- research facet. Item 1A is where a company is legally obliged to name what
-- could hurt it, so it is the most candid page it publishes about aging
-- systems, integration failures and control weaknesses.
alter table entities add column if not exists risks_json jsonb;
alter table entities add column if not exists risks_at timestamptz;
