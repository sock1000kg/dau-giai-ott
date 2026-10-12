CREATE TYPE account_role AS ENUM ('BTC_ADMIN', 'TEAM_ACCOUNT');
CREATE TYPE account_status AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE submission_status AS ENUM ('UPLOADED', 'INSPECTING', 'INVALID', 'PREFLIGHT', 'VALID', 'ACTIVE', 'SUPERSEDED', 'REVOKED');
CREATE TYPE match_status AS ENUM ('SCHEDULED', 'RUNNING', 'FINALIZED', 'FAILED', 'CANCELLED');

CREATE TABLE teams (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role account_role NOT NULL,
  status account_status NOT NULL DEFAULT 'ACTIVE',
  team_id UUID UNIQUE REFERENCES teams(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((role = 'TEAM_ACCOUNT' AND team_id IS NOT NULL) OR (role = 'BTC_ADMIN' AND team_id IS NULL))
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id),
  session_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_active_account_idx ON sessions (account_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE submissions (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id),
  tournament_stage TEXT NOT NULL DEFAULT 'QUALIFICATION',
  archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  oci_manifest_digest TEXT NOT NULL CHECK (oci_manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  oci_config_digest TEXT NOT NULL CHECK (oci_config_digest ~ '^sha256:[0-9a-f]{64}$'),
  entrypoint JSONB NOT NULL DEFAULT '[]'::jsonb,
  platform TEXT NOT NULL DEFAULT 'linux/amd64' CHECK (platform = 'linux/amd64'),
  object_key TEXT NOT NULL UNIQUE,
  policy_version TEXT NOT NULL DEFAULT 'P2_BASELINE_V1',
  status submission_status NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(entrypoint) = 'array')
);
CREATE UNIQUE INDEX submissions_one_active_per_team_stage_idx
  ON submissions (team_id, tournament_stage) WHERE status = 'ACTIVE';
CREATE INDEX submissions_team_created_idx ON submissions (team_id, created_at DESC);

CREATE FUNCTION reject_submission_identity_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.archive_sha256 IS DISTINCT FROM OLD.archive_sha256
    OR NEW.oci_manifest_digest IS DISTINCT FROM OLD.oci_manifest_digest
    OR NEW.oci_config_digest IS DISTINCT FROM OLD.oci_config_digest
    OR NEW.entrypoint IS DISTINCT FROM OLD.entrypoint
    OR NEW.platform IS DISTINCT FROM OLD.platform
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'submission OCI identity is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER submissions_identity_immutable
  BEFORE UPDATE ON submissions FOR EACH ROW EXECUTE FUNCTION reject_submission_identity_mutation();

CREATE TABLE series (
  id UUID PRIMARY KEY,
  tournament_stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE matches (
  id UUID PRIMARY KEY,
  series_id UUID NOT NULL REFERENCES series(id),
  x_submission_id UUID NOT NULL REFERENCES submissions(id),
  o_submission_id UUID NOT NULL REFERENCES submissions(id),
  status match_status NOT NULL DEFAULT 'SCHEDULED',
  map_checksum TEXT,
  seed TEXT,
  policy_version TEXT NOT NULL DEFAULT 'P2_BASELINE_V1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX matches_series_status_idx ON matches (series_id, status);

CREATE TABLE match_attempts (
  id UUID PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id),
  attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
  status TEXT NOT NULL,
  leased_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  failure_reason TEXT,
  UNIQUE (match_id, attempt_number)
);

CREATE TABLE match_events (
  match_id UUID NOT NULL REFERENCES matches(id),
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, sequence)
);

CREATE TABLE match_results (
  match_id UUID PRIMARY KEY REFERENCES matches(id),
  winner_side CHAR(1) CHECK (winner_side IN ('X', 'O')),
  reason TEXT NOT NULL,
  turn_count INTEGER NOT NULL CHECK (turn_count >= 0),
  final_state_hash TEXT NOT NULL CHECK (final_state_hash ~ '^[0-9a-f]{64}$'),
  event_log_key TEXT,
  event_log_sha256 TEXT CHECK (event_log_sha256 IS NULL OR event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  finalized_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE rating_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id UUID NOT NULL REFERENCES teams(id),
  series_id UUID NOT NULL REFERENCES series(id),
  rating_before INTEGER NOT NULL,
  rating_after INTEGER NOT NULL,
  delta INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (team_id, series_id),
  CHECK (rating_after = rating_before + delta)
);

CREATE TABLE audit_events (
  id UUID PRIMARY KEY,
  actor_account_id UUID REFERENCES accounts(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id UUID,
  reason TEXT,
  correlation_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX audit_events_target_idx ON audit_events (target_type, target_id, created_at DESC);
