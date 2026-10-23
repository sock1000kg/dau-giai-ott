-- Test-run portal contract: atomic admission, request idempotency and replay integrity.
ALTER TABLE test_runs
  ALTER COLUMN quota_consumed SET DEFAULT FALSE,
  ADD COLUMN idempotency_key TEXT,
  ADD COLUMN request_hash TEXT,
  ADD COLUMN replay_sha256 TEXT,
  ADD COLUMN final_state_hash TEXT;

CREATE UNIQUE INDEX test_runs_team_idempotency_key_idx
  ON test_runs (team_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX test_runs_team_started_quota_idx
  ON test_runs (team_id, started_at)
  WHERE quota_consumed = TRUE;

-- Database outbox makes the API commit and queue publication recoverable as one intent.
CREATE TABLE test_run_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  test_run_id UUID NOT NULL UNIQUE REFERENCES test_runs(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ
);

CREATE INDEX test_run_outbox_pending_idx
  ON test_run_outbox (created_at, id) WHERE dispatched_at IS NULL;

-- Artifacts are configured explicitly by deployment/demo setup. The sandbox corpus is
-- not implicitly promoted to a runtime opponent catalog.
CREATE TABLE test_run_reference_bots (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  manifest_digest TEXT NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  config_digest TEXT NOT NULL CHECK (config_digest ~ '^sha256:[0-9a-f]{64}$'),
  entrypoint JSONB NOT NULL CHECK (jsonb_typeof(entrypoint) = 'array'),
  policy_version TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX test_run_reference_bots_enabled_idx
  ON test_run_reference_bots (id)
  WHERE enabled = TRUE;
