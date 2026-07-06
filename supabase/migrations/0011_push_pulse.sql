-- Earnings Pulse (SPEC 6b): web-push subscriptions + filing-event log.

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
create policy push_own on public.push_subscriptions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- One row per detected filing (accession unique = notify once). Written only by
-- the cron via service role; readable by any signed-in user (entity data is
-- shared-directory scoped anyway).
create table public.filing_events (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  form       text not null,
  filed      date not null,
  accession  text not null unique,
  created_at timestamptz not null default now()
);
alter table public.filing_events enable row level security;
create policy filings_read on public.filing_events for select to authenticated using (true);

create index filing_events_entity on public.filing_events (entity_id, filed desc);
