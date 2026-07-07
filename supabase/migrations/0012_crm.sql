-- Account management layer: contacts (org chart) + activities (CRM-lite timeline).
-- Tenant-scoped through account -> list -> tenant, same pattern as accounts.

create table public.contacts (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  name        text not null,
  title       text,
  role_tag    text check (role_tag in ('economic_buyer','champion','exec_sponsor','influencer','end_user','blocker')),
  email       text,
  phone       text,
  reports_to  uuid references public.contacts(id) on delete set null,
  notes       text,
  created_at  timestamptz not null default now()
);
create index contacts_account on public.contacts (account_id);

create table public.activities (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references public.accounts(id) on delete cascade,
  contact_id  uuid references public.contacts(id) on delete set null,
  user_id     uuid references public.users(id) on delete set null,
  kind        text not null check (kind in ('note','call','meeting','email','task')),
  body        text not null,
  due_at      timestamptz,
  done        boolean not null default false,
  created_at  timestamptz not null default now()
);
create index activities_account on public.activities (account_id, created_at desc);

alter table public.contacts enable row level security;
alter table public.activities enable row level security;

create policy contacts_tenant on public.contacts for all to authenticated
  using (exists (select 1 from public.accounts a join public.account_lists l on l.id = a.list_id
                 where a.id = contacts.account_id and l.tenant_id = public.current_tenant_id()))
  with check (exists (select 1 from public.accounts a join public.account_lists l on l.id = a.list_id
                      where a.id = contacts.account_id and l.tenant_id = public.current_tenant_id()));

create policy activities_tenant on public.activities for all to authenticated
  using (exists (select 1 from public.accounts a join public.account_lists l on l.id = a.list_id
                 where a.id = activities.account_id and l.tenant_id = public.current_tenant_id()))
  with check (exists (select 1 from public.accounts a join public.account_lists l on l.id = a.list_id
                      where a.id = activities.account_id and l.tenant_id = public.current_tenant_id()));
