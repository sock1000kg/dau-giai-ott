-- Migration 0014: pinned rating policy per round, qualification gate results (capture_first_bot).

-- 1. Rating policy is pinned per round so existing ledgers (Phase 2) keep rebuilding with K=32.
ALTER TABLE rounds ADD COLUMN rating_policy_version TEXT NOT NULL DEFAULT 'elo-k32-v1'
  CHECK (rating_policy_version IN ('elo-k32-v1', 'elo-adaptive-k-v1'));

CREATE OR REPLACE FUNCTION reject_round_schedule_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tournament_stage IS DISTINCT FROM OLD.tournament_stage
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.schedule_seed IS DISTINCT FROM OLD.schedule_seed
    OR NEW.rating_snapshot IS DISTINCT FROM OLD.rating_snapshot
    OR NEW.rating_policy_version IS DISTINCT FROM OLD.rating_policy_version THEN
    RAISE EXCEPTION 'round schedule snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Gate results: two side-swapped games against the pinned gate bot; PASS needs >= 1 point.
CREATE TABLE submission_gate_results (
  id UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES submissions(id),
  gate_bot_id TEXT NOT NULL DEFAULT 'capture_first_bot' CHECK (char_length(gate_bot_id) BETWEEN 1 AND 100),
  gate_bot_digest TEXT NOT NULL CHECK (gate_bot_digest ~ '^sha256:[0-9a-f]{64}$'),
  game1_match_id UUID REFERENCES matches(id),
  game2_match_id UUID REFERENCES matches(id),
  game1_points NUMERIC(2,1) NOT NULL CHECK (game1_points IN (0, 0.5, 1)),
  game2_points NUMERIC(2,1) NOT NULL CHECK (game2_points IN (0, 0.5, 1)),
  points NUMERIC(2,1) NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('PASS', 'FAIL')),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (submission_id, gate_bot_id, gate_bot_digest),
  CHECK (points = game1_points + game2_points),
  CHECK ((outcome = 'PASS') = (points >= 1))
);
CREATE INDEX submission_gate_results_submission_idx ON submission_gate_results (submission_id, outcome);

CREATE TRIGGER submission_gate_results_append_only
  BEFORE UPDATE OR DELETE ON submission_gate_results FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
