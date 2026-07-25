-- 0023_account_created_by.sql — who added the account, and when.
-- `owner` can't answer this: 0017 defines it as the rep who added *or claimed*
-- the account, and it's reassignable from the Hub. created_by is written once
-- at insert and never changes, so attribution survives a hand-off.
-- Covered by the existing accounts RLS policies.
alter table public.accounts
  add column if not exists created_by uuid references public.users(id) on delete set null;

-- No backfill default on created_at: rows that predate this column genuinely
-- have an unknown add date, and defaulting them to now() would assert something
-- false. Existing rows stay null; new rows get the timestamp.
alter table public.accounts
  add column if not exists created_at timestamptz;
alter table public.accounts
  alter column created_at set default now();

-- Best available backfill for existing rows: every add path set owner = the
-- adder, so owner is correct unless the account was reassigned afterwards.
update public.accounts
   set created_by = owner
 where created_by is null
   and owner is not null;
