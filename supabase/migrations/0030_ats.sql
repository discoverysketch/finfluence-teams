-- 0030_ats.sql — where a company actually posts its jobs.
--
-- Hiring signals currently come from AI web search, and half the book comes
-- back "QUIET" — not because there are no openings, but because the search
-- never found the careers site. Con Edison reported QUIET while running 72
-- live openings naming Oracle, Maximo, PeopleSoft and ODI.
--
-- Every major ATS exposes a structured feed (Oracle Recruiting via GET,
-- Workday via POST, Greenhouse/Lever via REST). Resolving the tenant once and
-- storing it turns hiring from a $0.30 guess into a free, complete lookup —
-- and the same postings are the best available evidence for the battlecard.
alter table public.entities
  add column if not exists ats_platform text,   -- 'workday' | 'oracle' | 'greenhouse' | 'lever' | 'taleo' | 'icims'
  add column if not exists ats_url      text,   -- the feed or careers URL we resolved
  add column if not exists ats_at       timestamptz;
