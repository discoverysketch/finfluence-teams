-- Oracle's public standard contract documents, loaded from oracle.com/contracts.
--
-- Global reference data, not tenant data: these are the same published terms
-- for every customer, so there is no tenant_id and every signed-in user reads
-- the same rows. Only the service role writes them (the loader script).
--
-- Only CURRENT versions are stored. Oracle publishes every superseded version
-- alongside the live one — twelve DPAs, fifteen Hosting and Delivery Policies —
-- and a rep who quoted a 2014 policy in a live negotiation would be wrong in a
-- way that costs credibility. version_label and effective are NOT NULL so a
-- document can never be shown without saying which version it is.
create table if not exists contract_docs (
  id            uuid primary key default gen_random_uuid(),
  doc_key       text unique not null,
  title         text not null,
  category      text not null,
  source_url    text not null,
  version_label text not null,
  effective     text not null,
  chars         int  not null,
  fetched_at    timestamptz not null default now()
);

-- Retrieval unit. Chunked at load so a question can be answered from the two
-- or three clauses that actually govern it rather than from whole documents.
create table if not exists contract_chunks (
  id       bigserial primary key,
  doc_key  text not null references contract_docs(doc_key) on delete cascade,
  idx      int  not null,
  heading  text,
  body     text not null,
  tsv      tsvector generated always as (to_tsvector('english', coalesce(heading,'') || ' ' || body)) stored
);
create index if not exists contract_chunks_tsv    on contract_chunks using gin(tsv);
create index if not exists contract_chunks_dockey on contract_chunks(doc_key);

-- Answers are cached across the whole install: the documents are identical for
-- every tenant, so the second rep to ask a question pays nothing. Keyed by the
-- question and the corpus version, so a reload of the documents invalidates
-- every answer drawn from the old text.
create table if not exists contract_answers (
  id          uuid primary key default gen_random_uuid(),
  qhash       text not null,
  corpus_tag  text not null,
  question    text not null,
  topic_key   text,
  answer_json jsonb not null,
  created_at  timestamptz not null default now(),
  unique (qhash, corpus_tag)
);

alter table contract_docs    enable row level security;
alter table contract_chunks  enable row level security;
alter table contract_answers enable row level security;

drop policy if exists contract_docs_read    on contract_docs;
drop policy if exists contract_chunks_read  on contract_chunks;
drop policy if exists contract_answers_read on contract_answers;
create policy contract_docs_read    on contract_docs    for select to authenticated using (true);
create policy contract_chunks_read  on contract_chunks  for select to authenticated using (true);
create policy contract_answers_read on contract_answers for select to authenticated using (true);

-- Small global key/value store. Holds the corpus tag that stamps cached
-- answers, so reloading the documents retires every answer built on the old text.
create table if not exists app_settings (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
drop policy if exists app_settings_read on app_settings;
create policy app_settings_read on app_settings for select to authenticated using (true);
