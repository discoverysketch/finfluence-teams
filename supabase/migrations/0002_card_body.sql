-- Rich flashcard content (term prompt + labeled back sections + worked example) that
-- doesn't fit the plain front/back columns. Quiz cards keep using options_json/correct_index.
alter table public.cards add column if not exists body_json jsonb;
