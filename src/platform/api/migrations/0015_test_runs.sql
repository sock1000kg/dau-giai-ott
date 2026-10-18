-- Migration 0015: Test-runs flow, quota tracking, opponent policy and private artifacts (P3-N03)

CREATE TYPE test_run_status AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE test_run_opponent_type AS ENUM ('BTC_REFERENCE', 'OWN_SUBMISSION');

CREATE TABLE test_runs (
  id UUID PRIMARY KEY,
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  round_id UUID REFERENCES qualification_rounds(id) ON DELETE SET NULL,
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  opponent_type test_run_opponent_type NOT NULL,
  opponent_submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,
  opponent_reference_bot TEXT,
  status test_run_status NOT NULL DEFAULT 'QUEUED',
  quota_consumed BOOLEAN NOT NULL DEFAULT TRUE,
  map_checksum TEXT NOT NULL,
  seed TEXT NOT NULL,
  result JSONB,
  replay_key TEXT,
  stderr_x TEXT,
  stderr_o TEXT,
  failure_reason TEXT,
  is_infra_failure BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  CHECK (
    (opponent_type = 'OWN_SUBMISSION' AND opponent_submission_id IS NOT NULL) OR
    (opponent_type = 'BTC_REFERENCE' AND opponent_reference_bot IS NOT NULL)
  )
);

CREATE INDEX test_runs_team_created_idx ON test_runs (team_id, created_at DESC);
CREATE INDEX test_runs_status_idx ON test_runs (status, created_at ASC);
CREATE INDEX test_runs_quota_calc_idx ON test_runs (team_id, created_at) WHERE quota_consumed = TRUE;

