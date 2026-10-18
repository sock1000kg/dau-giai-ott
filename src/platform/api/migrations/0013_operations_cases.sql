-- Migration 0013: privileged operations, anti-cheat/appeal cases, public queue overrides, round results hash.
-- Operations never edit history: every table below is append-only or has a one-way state machine.

-- 1. audit_events becomes append-only at DB level (TRUNCATE stays available for test fixtures).
ALTER TABLE audit_events ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX audit_events_idempotency_idx
  ON audit_events (actor_account_id, action, idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE FUNCTION reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;
CREATE TRIGGER audit_events_append_only
  BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- 2. Operations cases (anomaly / duplicate / appeal).
CREATE TABLE operations_cases (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('ANOMALY', 'DUPLICATE', 'APPEAL')),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'DECIDED', 'CLOSED')),
  team_id UUID REFERENCES teams(id),
  round_id UUID REFERENCES qualification_rounds(id),
  submission_id UUID REFERENCES submissions(id),
  match_id UUID REFERENCES matches(id),
  series_id UUID REFERENCES series(id),
  opened_by UUID NOT NULL REFERENCES accounts(id),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  correlation_id UUID NOT NULL
);
CREATE INDEX operations_cases_status_idx ON operations_cases (status, opened_at DESC);
CREATE UNIQUE INDEX operations_cases_one_duplicate_per_submission_idx
  ON operations_cases (submission_id) WHERE kind = 'DUPLICATE';

CREATE FUNCTION enforce_operations_case_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'operations_cases rows cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.team_id IS DISTINCT FROM OLD.team_id
    OR NEW.round_id IS DISTINCT FROM OLD.round_id
    OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
    OR NEW.match_id IS DISTINCT FROM OLD.match_id
    OR NEW.series_id IS DISTINCT FROM OLD.series_id
    OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
    OR NEW.opened_at IS DISTINCT FROM OLD.opened_at
    OR NEW.correlation_id IS DISTINCT FROM OLD.correlation_id THEN
    RAISE EXCEPTION 'operations_cases identity is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    IF NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN
      RAISE EXCEPTION 'operations_cases decided_at changes only with a status transition';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status = 'OPEN' AND NEW.status IN ('UNDER_REVIEW', 'DECIDED'))
    OR (OLD.status = 'UNDER_REVIEW' AND NEW.status = 'DECIDED')
    OR (OLD.status = 'DECIDED' AND NEW.status = 'CLOSED') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'operations_cases status transition not allowed: % -> %', OLD.status, NEW.status;
END;
$$;
CREATE TRIGGER operations_cases_state_machine
  BEFORE UPDATE OR DELETE ON operations_cases FOR EACH ROW EXECUTE FUNCTION enforce_operations_case_transition();

CREATE TABLE operations_case_events (
  id UUID PRIMARY KEY,
  case_id UUID NOT NULL REFERENCES operations_cases(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  event_type TEXT NOT NULL CHECK (event_type IN ('OPENED', 'EVIDENCE_ADDED', 'STATUS_CHANGED', 'DECIDED')),
  actor_account_id UUID NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL CHECK (char_length(reason) BETWEEN 1 AND 500),
  evidence JSONB CHECK (evidence IS NULL OR (jsonb_typeof(evidence) = 'object' AND pg_column_size(evidence) <= 8192)),
  decision TEXT CHECK (decision IS NULL OR decision IN ('NO_ACTION', 'WARN', 'REVOKE_SUBMISSION', 'SUSPEND_TEAM', 'RERUN_APPROVED', 'APPEAL_UPHELD', 'APPEAL_REJECTED')),
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, seq),
  CHECK ((event_type = 'DECIDED') = (decision IS NOT NULL))
);
CREATE TRIGGER operations_case_events_append_only
  BEFORE UPDATE OR DELETE ON operations_case_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- 3. Public queue override log.
CREATE TABLE queue_overrides (
  id UUID PRIMARY KEY,
  action TEXT NOT NULL CHECK (action IN ('RERUN', 'CANCEL', 'PRIORITIZE', 'DEFER')),
  match_id UUID NOT NULL REFERENCES matches(id),
  public_reason TEXT NOT NULL CHECK (char_length(public_reason) BETWEEN 1 AND 200),
  case_id UUID REFERENCES operations_cases(id),
  actor_account_id UUID NOT NULL REFERENCES accounts(id),
  correlation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX queue_overrides_created_idx ON queue_overrides (created_at DESC, id);
CREATE TRIGGER queue_overrides_append_only
  BEFORE UPDATE OR DELETE ON queue_overrides FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

-- 4. Round results hash, set once at publish.
ALTER TABLE qualification_rounds
  ADD COLUMN results_hash TEXT CHECK (results_hash IS NULL OR results_hash ~ '^[0-9a-f]{64}$');

CREATE OR REPLACE FUNCTION reject_qualification_round_immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id AND OLD.rule_set_id IS NOT NULL THEN
    RAISE EXCEPTION 'qualification_round rule_set_id is immutable once set';
  END IF;
  IF NEW.schedule_round_id IS DISTINCT FROM OLD.schedule_round_id AND OLD.schedule_round_id IS NOT NULL THEN
    RAISE EXCEPTION 'qualification_round schedule_round_id is immutable once set';
  END IF;
  IF NEW.start_idempotency_key IS DISTINCT FROM OLD.start_idempotency_key AND OLD.start_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION 'qualification_round start_idempotency_key is immutable once set';
  END IF;
  IF NEW.start_request_hash IS DISTINCT FROM OLD.start_request_hash AND OLD.start_request_hash IS NOT NULL THEN
    RAISE EXCEPTION 'qualification_round start_request_hash is immutable once set';
  END IF;
  IF NEW.tournament_stage IS DISTINCT FROM OLD.tournament_stage THEN
    RAISE EXCEPTION 'qualification_round tournament_stage is immutable';
  END IF;
  IF NEW.round_number IS DISTINCT FROM OLD.round_number THEN
    RAISE EXCEPTION 'qualification_round round_number is immutable';
  END IF;
  IF NEW.results_hash IS DISTINCT FROM OLD.results_hash THEN
    IF OLD.results_hash IS NOT NULL THEN
      RAISE EXCEPTION 'qualification_round results_hash is immutable once set';
    END IF;
    IF NEW.status IS DISTINCT FROM 'PUBLISHED' THEN
      RAISE EXCEPTION 'qualification_round results_hash is set only at publish';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 5. Outbox generations so a rerun can publish a second job for the same match.
ALTER TABLE match_outbox ADD COLUMN generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0);
DO $$
DECLARE
  old_constraint TEXT;
BEGIN
  SELECT c.conname INTO old_constraint
  FROM pg_constraint c
  WHERE c.conrelid = 'match_outbox'::regclass
    AND c.contype = 'u'
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname::text)
         FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)) = ARRAY['event_type', 'match_id'];
  IF old_constraint IS NULL THEN
    RAISE EXCEPTION 'match_outbox UNIQUE (match_id, event_type) constraint not found';
  END IF;
  EXECUTE format('ALTER TABLE match_outbox DROP CONSTRAINT %I', old_constraint);
END;
$$;
ALTER TABLE match_outbox
  ADD CONSTRAINT match_outbox_match_event_generation_key UNIQUE (match_id, event_type, generation);
