-- 0028_entity_website.sql — the company's own website.
--
-- Useful on its own (a rep wants the link), and it's what the account logo is
-- derived from. Previously the domain was mined heuristically out of URLs left
-- behind by research, which covered only a third of the book and, when it
-- guessed from the company name, produced other companies' domains entirely
-- (american.com for AEP, enterprise.com for PSEG). Storing it makes the logo
-- deterministic and correctable by hand.
alter table public.entities
  add column if not exists website text;
