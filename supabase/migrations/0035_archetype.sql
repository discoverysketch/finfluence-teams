-- What KIND of company this is, and who owns it.
--
-- Every research prompt assumed "a US utility". That is right for most of the
-- book and useless for the rest: a wholly-owned subsidiary has no SEC filings,
-- no FERC Form 1 and no EIA data, so a utility-shaped search returns nothing
-- and the account looks empty when it is merely different.
--
-- archetype is nullable on purpose — it is inferred from sic/cik/ticker/name at
-- read time, and only stored when someone overrides that inference.
alter table entities add column if not exists archetype   text;
alter table entities add column if not exists parent_name text;
alter table entities add column if not exists parent_cik  text;

-- Business picture for accounts the filings do not describe.
alter table entities add column if not exists business_json jsonb;
alter table entities add column if not exists business_at   timestamptz;
