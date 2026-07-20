-- 0016_suggested_execs.sql — staged people research on accounts.
-- When an account is added (CSV match, whitespace add, or Tier D profile save),
-- the app web-researches its leadership in the background and stages the found
-- roster here. The Account Hub shows it as a pre-filled review list; nothing
-- becomes a contact until the rep approves (human-in-the-loop). Covered by the
-- existing accounts RLS policies.
alter table public.accounts
  add column if not exists suggested_execs jsonb,
  add column if not exists execs_status text; -- pending | ready | none | error
