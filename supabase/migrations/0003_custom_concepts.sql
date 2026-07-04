-- Custom vs seeded content.
-- The shipped curriculum is "seeded" and read-only in the Content editor.
-- Anything an admin creates in the editor is custom (is_seeded = false):
-- it appears in the learning path but is practice-only (never feeds Acumen).

alter table public.units add column if not exists is_seeded boolean not null default false;
alter table public.cards add column if not exists is_seeded boolean not null default false;

-- Backfill: everything that exists at migration time is the shipped curriculum.
update public.units set is_seeded = true;
update public.cards set is_seeded = true;
