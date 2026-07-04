# FinFluency Teams

Multi-tenant sales-enablement product — the team/SaaS evolution of the single-file FinFluency PWA
(live at finfluence-xi.vercel.app, which stays running as the reference app during this build).

- **Full product spec:** [SPEC.md](SPEC.md) — build phase-by-phase per §9, gate each phase on its exit test.
- **Stack conventions:** [CLAUDE.md](CLAUDE.md).

## Status: Phase 1 scaffold (foundation)
Done in this repo so far:
- Next.js (App Router) + TypeScript scaffold
- Supabase auth (magic link) + middleware session gating
- **Full Postgres schema + RLS policies** — `supabase/migrations/0001_init.sql` (SPEC §3)
- Authed home + login/callback/signout

Not yet done (next slices of Phase 1): port the learning path + Company Challenge from the current
app into components reading content from the DB; migrate localStorage progress → DB with offline
sync; seed the default content pack from the current curriculum + Solutions/Wins decks.

## Setup
Prereqs: Node 18+, a Supabase project, an Anthropic API key.

1. `npm install`
2. `cp .env.local.example .env.local` and fill in Supabase URL + anon key + service-role key + Anthropic key.
3. Apply the schema: in the Supabase SQL editor, run `supabase/migrations/0001_init.sql`
   (or `supabase db push` with the Supabase CLI).
4. In Supabase → Authentication → URL Configuration, add `http://localhost:3000/auth/callback`
   (and your Vercel URL later) as a redirect URL.
5. `npm run dev` → http://localhost:3000

### Bootstrapping the first tenant/admin (until the roster UI exists, Phase 2)
Auth creates an `auth.users` row on first magic-link login, but **not** a `public.users` profile.
Create a tenant and link yourself as admin via the SQL editor (service role):
```sql
insert into tenants (name) values ('Acme Sales') returning id;   -- copy the id
insert into users (id, tenant_id, email, role)
values ('<your-auth-user-uuid>', '<tenant-id>', 'you@company.com', 'admin');
```
(Your auth user UUID is in Supabase → Authentication → Users after you log in once.)

## Conventions
See [CLAUDE.md](CLAUDE.md). Key rules: RLS before UI · every fact carries `source_url` ·
human-in-the-loop for AI content · concept tags unify learning + planning · cache Claude calls in `entity_facts`.
