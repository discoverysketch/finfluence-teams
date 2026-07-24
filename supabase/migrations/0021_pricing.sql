-- 0021_pricing.sql — Oracle public list pricing (shared reference, admin-managed).
-- Public price-list data (same for everyone), so NOT tenant-scoped: any signed-in
-- user can read; only admins write (enforced in the API via service role).
create table if not exists public.pricing_products (
  id uuid primary key default gen_random_uuid(),
  family text not null,          -- ERP | EPM | SCM | HCM | EnergyWater
  name text not null,
  metric text not null,          -- e.g. "Hosted Employee/month", "Hosted Named User/month"
  list_price numeric not null,
  currency text not null default 'USD',
  ord int not null default 0,
  as_of text,
  updated_at timestamptz not null default now()
);

alter table public.pricing_products enable row level security;

drop policy if exists pricing_read on public.pricing_products;
create policy pricing_read on public.pricing_products
  for select to authenticated using (true);
-- Writes go through the service role (admin-gated API), so no write policy here.
