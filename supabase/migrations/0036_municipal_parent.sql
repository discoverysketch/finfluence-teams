-- Public-sector buying signals (RFPs, awards, board approvals, budget lines)
-- and parent-company context for subsidiaries that file nothing themselves.
alter table entities add column if not exists municipal_json jsonb;
alter table entities add column if not exists municipal_at   timestamptz;
alter table entities add column if not exists parent_json    jsonb;
alter table entities add column if not exists parent_at      timestamptz;
