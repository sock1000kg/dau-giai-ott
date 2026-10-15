CREATE TABLE round_rule_sets (
  id UUID PRIMARY KEY,
  tournament_stage TEXT NOT NULL CHECK (tournament_stage ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  version INTEGER NOT NULL CHECK (version > 0),
  rules JSONB NOT NULL,
  rules_sha256 TEXT NOT NULL CHECK (rules_sha256 ~ '^[0-9a-f]{64}$'),
  created_by UUID NOT NULL REFERENCES accounts(id),
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_stage, version)
);

CREATE FUNCTION reject_round_rule_set_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'round_rule_set is immutable';
END;
$$;
CREATE TRIGGER round_rule_sets_immutable
  BEFORE UPDATE OR DELETE ON round_rule_sets FOR EACH ROW EXECUTE FUNCTION reject_round_rule_set_mutation();

CREATE TABLE qualification_rounds (
  id UUID PRIMARY KEY,
  tournament_stage TEXT NOT NULL CHECK (tournament_stage ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  round_number INTEGER NOT NULL CHECK (round_number > 0),
  status TEXT NOT NULL DEFAULT 'DRAFT_RULES' CHECK (status IN ('DRAFT_RULES','SUBMISSION_OPEN','SUBMISSION_CLOSED','RUNNING','SETTLING','RATED','PUBLISHED')),
  rule_set_id UUID REFERENCES round_rule_sets(id),
  schedule_round_id UUID REFERENCES rounds(id),
  start_idempotency_key TEXT,
  start_request_hash TEXT CHECK (start_request_hash IS NULL OR start_request_hash ~ '^[0-9a-f]{64}$'),
  paused_at TIMESTAMPTZ,
  opened_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  rated_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_stage, round_number),
  UNIQUE (schedule_round_id)
);

CREATE UNIQUE INDEX qualification_rounds_one_active_per_stage_idx
  ON qualification_rounds (tournament_stage)
  WHERE status <> 'PUBLISHED';

CREATE FUNCTION reject_qualification_round_immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
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
  RETURN NEW;
END;
$$;
CREATE TRIGGER qualification_rounds_immutable_fields
  BEFORE UPDATE ON qualification_rounds FOR EACH ROW EXECUTE FUNCTION reject_qualification_round_immutable_fields();

CREATE FUNCTION reject_qualification_round_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'DRAFT_RULES' AND NEW.status = 'SUBMISSION_OPEN' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'SUBMISSION_OPEN' AND NEW.status = 'SUBMISSION_CLOSED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'SUBMISSION_CLOSED' AND NEW.status = 'RUNNING' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'RUNNING' AND NEW.status = 'RUNNING' AND (OLD.paused_at IS NULL AND NEW.paused_at IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'RUNNING' AND NEW.status = 'RUNNING' AND (OLD.paused_at IS NOT NULL AND NEW.paused_at IS NULL) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'RUNNING' AND NEW.status = 'SETTLING' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'SETTLING' AND NEW.status = 'RATED' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'RATED' AND NEW.status = 'PUBLISHED' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'qualification_round status transition not allowed: % -> %', OLD.status, NEW.status;
END;
$$;
CREATE TRIGGER qualification_rounds_status_transition
  BEFORE UPDATE ON qualification_rounds FOR EACH ROW EXECUTE FUNCTION reject_qualification_round_status_transition();

CREATE FUNCTION reject_qualification_round_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'qualification_round deletion is not allowed';
END;
$$;
CREATE TRIGGER qualification_rounds_no_delete
  BEFORE DELETE ON qualification_rounds FOR EACH ROW EXECUTE FUNCTION reject_qualification_round_delete();

CREATE FUNCTION check_rule_set_same_stage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_set_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM round_rule_sets rrs WHERE rrs.id = NEW.rule_set_id AND rrs.tournament_stage <> NEW.tournament_stage
    ) THEN
      RAISE EXCEPTION 'round_rule_set must belong to the same tournament_stage as qualification_round';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER qualification_rounds_rule_set_stage_check
  BEFORE INSERT OR UPDATE ON qualification_rounds FOR EACH ROW EXECUTE FUNCTION check_rule_set_same_stage();

ALTER TABLE audit_events ADD COLUMN details JSONB;