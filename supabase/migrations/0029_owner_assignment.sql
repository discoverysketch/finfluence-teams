-- 0029_owner_assignment.sql — admins assign accounts; reps don't self-assign.
--
-- Every rep can already SEE every account (accounts_tenant is tenant-scoped,
-- and that stays — shared visibility is the point of a team book). What that
-- policy also allowed was any rep reassigning any account to themselves.
--
-- This is column-level, not row-level: a rep must still be able to edit
-- rep_notes on any account, but must not change `owner`. RLS can't express
-- that, so it's a trigger.
create or replace function public.enforce_owner_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.owner is distinct from old.owner and not public.is_manager_admin() then
    raise exception 'Only an admin or manager can assign account owners';
  end if;
  return new;
end;
$$;

drop trigger if exists accounts_owner_guard on public.accounts;
create trigger accounts_owner_guard
  before update on public.accounts
  for each row execute function public.enforce_owner_assignment();

-- Note: the research ROUTES enforce "you may only research your own accounts"
-- in application code, because that rule is about spending money and calling
-- an external API, not about database access — a rep can still read every
-- account's cached research, which is the intent.
