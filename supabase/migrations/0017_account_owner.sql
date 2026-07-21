-- 0017_account_owner.sql — per-rep account ownership in the shared tenant book.
-- owner = the rep who added (or claimed) the account; null = team/unassigned.
-- Drives Mine|Team filters on Book/Board/Map and per-rep digest scoping.
-- Covered by existing accounts RLS policies.
alter table public.accounts
  add column if not exists owner uuid references public.users(id) on delete set null;
