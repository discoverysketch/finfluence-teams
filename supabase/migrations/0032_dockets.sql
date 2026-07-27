-- Rate case dockets. Testimony filed with a state utility commission is where
-- a utility justifies its capital spending under oath, so it is the one public
-- place that names the systems being replaced, what they cost and when.
alter table entities add column if not exists dockets_json jsonb;
alter table entities add column if not exists dockets_at timestamptz;
