-- Industry news feed: daily web-researched utility/power sector items (capital
-- projects, data centers, regulatory, M&A). Shared across tenants; written only
-- by the cron via service role; url-unique for dedupe.
create table public.news_items (
  id         uuid primary key default gen_random_uuid(),
  headline   text not null,
  summary    text not null,
  category   text not null check (category in ('capital_projects','data_centers','regulatory','rates','ma','grid','other')),
  source_url text not null unique,
  published  date,
  companies  text,
  created_at timestamptz not null default now()
);
alter table public.news_items enable row level security;
create policy news_read on public.news_items for select to authenticated using (true);
create index news_items_recent on public.news_items (created_at desc);
