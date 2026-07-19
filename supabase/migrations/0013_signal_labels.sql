-- Buying-signal feed: filing_events carries the classified label + raw 8-K item
-- codes (10-K/10-Q rows keep label too, e.g. "Quarterly report (10-Q) filed").
alter table public.filing_events add column if not exists label text;
alter table public.filing_events add column if not exists items text;
