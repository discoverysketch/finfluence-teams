-- FinFluency Teams — initial schema + Row-Level Security (SPEC §3)
-- RLS-first: every tenant-scoped table has policies defined here, before any UI.
-- Shared entity directory rows (entities.created_by_tenant IS NULL) are readable by all tenants.
-- NOTE: pg_trgm + trigram GIN indexes for fuzzy entity matching are added in Phase 5, not here.
-- NOTE: helper functions are defined AFTER the tables they reference (see below), then policies.

-- ============================================================
-- Core tenancy
-- ============================================================
create table public.tenants (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  display_mode  text not null default 'playful' check (display_mode in ('playful','professional')),
  branding_json jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create table public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid references public.tenants(id) on delete cascade,
  email      text not null,
  role       text not null default 'rep' check (role in ('rep','manager','admin')),
  manager_id uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Content
-- ============================================================
create table public.content_packs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null,
  description text,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.units (
  id       uuid primary key default gen_random_uuid(),
  pack_id  uuid not null references public.content_packs(id) on delete cascade,
  title    text not null,
  "order"  int not null default 0,
  icon     text
);

create table public.cards (
  id            uuid primary key default gen_random_uuid(),
  unit_id       uuid not null references public.units(id) on delete cascade,
  type          text not null default 'flashcard' check (type in ('flashcard','quiz','swipe')),
  front         text,
  back          text,
  options_json  jsonb,
  correct_index int,
  explanation   text,
  concept_tag   text,
  "order"       int not null default 0
);

-- ============================================================
-- Entity layer (shared directory + tenant-private) — see SPEC §3/§4
-- ============================================================
create table public.entities (
  id                 uuid primary key default gen_random_uuid(),
  canonical_name     text not null,
  entity_type        text check (entity_type in ('iou','ipp','coop','muni','retailer','other')),
  cik                text,
  lei                text,
  ferc_respondent_id text,
  eia_utility_id     text,
  ticker             text,
  parent_entity_id   uuid references public.entities(id),
  hq_state           text,
  data_tier          text check (data_tier in ('A','B','C','D')),
  profile_json       jsonb,                                   -- Claude-researched, sourced
  created_by_tenant  uuid references public.tenants(id),      -- NULL = shared directory
  created_at         timestamptz not null default now()
);
create index entities_tenant on public.entities (created_by_tenant);

create table public.entity_aliases (
  id        uuid primary key default gen_random_uuid(),
  entity_id uuid not null references public.entities(id) on delete cascade,
  alias     text not null,
  source    text check (source in ('user','gleif','sec','eia'))
);

create table public.entity_facts (
  id         uuid primary key default gen_random_uuid(),
  entity_id  uuid not null references public.entities(id) on delete cascade,
  source     text check (source in ('sec','ferc','eia','emma','user')),
  fact_key   text not null,
  period     text,
  value      numeric,
  unit       text,
  fetched_at timestamptz not null default now(),
  source_url text                                             -- no source_url => render "unverified"
);
create index entity_facts_lookup on public.entity_facts (entity_id, fact_key, period);

-- ============================================================
-- Territory (tenant-scoped)
-- ============================================================
create table public.account_lists (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);

create table public.accounts (
  id                 uuid primary key default gen_random_uuid(),
  list_id            uuid not null references public.account_lists(id) on delete cascade,
  entity_id          uuid references public.entities(id),
  rep_notes          text,
  tier_override      text,
  crm_stage          text,
  custom_fields_json jsonb not null default '{}'
);

create table public.assignments (
  user_id         uuid not null references public.users(id) on delete cascade,
  account_list_id uuid not null references public.account_lists(id) on delete cascade,
  primary key (user_id, account_list_id)
);

-- ============================================================
-- Learning (per-user, manager-readable within tenant)
-- ============================================================
create table public.progress (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  card_id     uuid not null references public.cards(id) on delete cascade,
  status      text,
  ease        numeric,
  due_at      timestamptz,
  streak_data jsonb not null default '{}',
  updated_at  timestamptz not null default now(),
  unique (user_id, card_id)
);

create table public.challenge_runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  mode           text,
  entity_ids     uuid[],
  score          numeric,
  duration       int,
  questions_json jsonb,
  created_at     timestamptz not null default now()
);

create table public.score_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  concept_tag text,
  correct     boolean,
  difficulty  text,
  source_mode text,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- Enable RLS on everything
-- ============================================================
alter table public.tenants        enable row level security;
alter table public.users          enable row level security;
alter table public.content_packs  enable row level security;
alter table public.units          enable row level security;
alter table public.cards          enable row level security;
alter table public.entities       enable row level security;
alter table public.entity_aliases enable row level security;
alter table public.entity_facts   enable row level security;
alter table public.account_lists  enable row level security;
alter table public.accounts       enable row level security;
alter table public.assignments    enable row level security;
alter table public.progress       enable row level security;
alter table public.challenge_runs enable row level security;
alter table public.score_events   enable row level security;

-- ===== Helper functions (defined after tables; SECURITY DEFINER bypasses RLS on public.users) =====
create or replace function public.current_tenant_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select tenant_id from public.users where id = auth.uid()
$$;
create or replace function public.app_role() returns text
  language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;
create or replace function public.is_manager_admin() returns boolean
  language sql stable as $$ select public.app_role() in ('manager','admin') $$;

-- ---------- tenants ----------
create policy tenants_select on public.tenants for select to authenticated
  using (id = public.current_tenant_id());
create policy tenants_update on public.tenants for update to authenticated
  using (id = public.current_tenant_id() and public.app_role() = 'admin');

-- ---------- users ----------
create policy users_select_self_or_tenant on public.users for select to authenticated
  using (id = auth.uid() or tenant_id = public.current_tenant_id());
create policy users_admin_write on public.users for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.app_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.app_role() = 'admin');

-- ---------- content_packs ----------
create policy packs_select on public.content_packs for select to authenticated
  using (tenant_id = public.current_tenant_id());
create policy packs_admin_write on public.content_packs for all to authenticated
  using (tenant_id = public.current_tenant_id() and public.app_role() = 'admin')
  with check (tenant_id = public.current_tenant_id() and public.app_role() = 'admin');

-- ---------- units (via pack.tenant_id) ----------
create policy units_select on public.units for select to authenticated
  using (exists (select 1 from public.content_packs p
                 where p.id = units.pack_id and p.tenant_id = public.current_tenant_id()));
create policy units_admin_write on public.units for all to authenticated
  using (exists (select 1 from public.content_packs p
                 where p.id = units.pack_id and p.tenant_id = public.current_tenant_id() and public.app_role() = 'admin'))
  with check (exists (select 1 from public.content_packs p
                 where p.id = units.pack_id and p.tenant_id = public.current_tenant_id() and public.app_role() = 'admin'));

-- ---------- cards (via unit -> pack.tenant_id) ----------
create policy cards_select on public.cards for select to authenticated
  using (exists (select 1 from public.units u join public.content_packs p on p.id = u.pack_id
                 where u.id = cards.unit_id and p.tenant_id = public.current_tenant_id()));
create policy cards_admin_write on public.cards for all to authenticated
  using (exists (select 1 from public.units u join public.content_packs p on p.id = u.pack_id
                 where u.id = cards.unit_id and p.tenant_id = public.current_tenant_id() and public.app_role() = 'admin'))
  with check (exists (select 1 from public.units u join public.content_packs p on p.id = u.pack_id
                 where u.id = cards.unit_id and p.tenant_id = public.current_tenant_id() and public.app_role() = 'admin'));

-- ---------- entities (shared directory OR tenant-private) ----------
create policy entities_select on public.entities for select to authenticated
  using (created_by_tenant is null or created_by_tenant = public.current_tenant_id());
-- tenants can create/edit their OWN private entities; shared-directory rows are managed by the service role.
create policy entities_tenant_write on public.entities for all to authenticated
  using (created_by_tenant = public.current_tenant_id())
  with check (created_by_tenant = public.current_tenant_id());

-- ---------- entity_aliases / entity_facts (visible iff parent entity visible) ----------
create policy aliases_select on public.entity_aliases for select to authenticated
  using (exists (select 1 from public.entities e where e.id = entity_aliases.entity_id
                 and (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())));
create policy aliases_tenant_write on public.entity_aliases for all to authenticated
  using (exists (select 1 from public.entities e where e.id = entity_aliases.entity_id and e.created_by_tenant = public.current_tenant_id()))
  with check (exists (select 1 from public.entities e where e.id = entity_aliases.entity_id and e.created_by_tenant = public.current_tenant_id()));

create policy facts_select on public.entity_facts for select to authenticated
  using (exists (select 1 from public.entities e where e.id = entity_facts.entity_id
                 and (e.created_by_tenant is null or e.created_by_tenant = public.current_tenant_id())));
create policy facts_tenant_write on public.entity_facts for all to authenticated
  using (exists (select 1 from public.entities e where e.id = entity_facts.entity_id and e.created_by_tenant = public.current_tenant_id()))
  with check (exists (select 1 from public.entities e where e.id = entity_facts.entity_id and e.created_by_tenant = public.current_tenant_id()));

-- ---------- account_lists / accounts / assignments (tenant-scoped) ----------
create policy lists_tenant on public.account_lists for all to authenticated
  using (tenant_id = public.current_tenant_id())
  with check (tenant_id = public.current_tenant_id());

create policy accounts_tenant on public.accounts for all to authenticated
  using (exists (select 1 from public.account_lists l where l.id = accounts.list_id and l.tenant_id = public.current_tenant_id()))
  with check (exists (select 1 from public.account_lists l where l.id = accounts.list_id and l.tenant_id = public.current_tenant_id()));

create policy assignments_tenant on public.assignments for all to authenticated
  using (exists (select 1 from public.account_lists l where l.id = assignments.account_list_id and l.tenant_id = public.current_tenant_id()))
  with check (exists (select 1 from public.account_lists l where l.id = assignments.account_list_id and l.tenant_id = public.current_tenant_id()));

-- ---------- learning: own rows; managers/admins read their tenant's rows ----------
create policy progress_own_write on public.progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy progress_mgr_read on public.progress for select to authenticated
  using (public.is_manager_admin() and exists
         (select 1 from public.users u where u.id = progress.user_id and u.tenant_id = public.current_tenant_id()));

create policy runs_own_write on public.challenge_runs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy runs_mgr_read on public.challenge_runs for select to authenticated
  using (public.is_manager_admin() and exists
         (select 1 from public.users u where u.id = challenge_runs.user_id and u.tenant_id = public.current_tenant_id()));

create policy events_own_write on public.score_events for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy events_mgr_read on public.score_events for select to authenticated
  using (public.is_manager_admin() and exists
         (select 1 from public.users u where u.id = score_events.user_id and u.tenant_id = public.current_tenant_id()));

-- ============================================================
-- Provisioning note:
--   auth.users rows are created by Supabase Auth (magic link). A matching public.users
--   row (with tenant_id + role) is inserted by an admin/service-role flow (roster upload,
--   Phase 2). We deliberately do NOT auto-create tenantless profiles on signup.
-- ============================================================
