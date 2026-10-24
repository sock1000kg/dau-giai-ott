-- Migration 0021: BTC can cancel a qualification round before `start` (no series/matches exist yet).
-- CANCELLED is terminal. Only DRAFT_RULES / SUBMISSION_OPEN / SUBMISSION_CLOSED may move to it; the service
-- additionally refuses a SUBMISSION_CLOSED round whose start was already initiated.

ALTER TABLE qualification_rounds
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancel_reason TEXT CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 500);

ALTER TABLE qualification_rounds DROP CONSTRAINT qualification_rounds_status_check;
ALTER TABLE qualification_rounds ADD CONSTRAINT qualification_rounds_status_check
  CHECK (status IN ('DRAFT_RULES','SUBMISSION_OPEN','SUBMISSION_CLOSED','RUNNING','SETTLING','RATED','PUBLISHED','CANCELLED'));

-- A cancelled round no longer occupies the single active slot of its stage.
DROP INDEX qualification_rounds_one_active_per_stage_idx;
CREATE UNIQUE INDEX qualification_rounds_one_active_per_stage_idx
  ON qualification_rounds (tournament_stage)
  WHERE status NOT IN ('PUBLISHED', 'CANCELLED');

CREATE OR REPLACE FUNCTION reject_qualification_round_status_transition() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF OLD.status IN ('DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED') AND NEW.status = 'CANCELLED' THEN
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
