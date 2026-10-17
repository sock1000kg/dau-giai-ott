CREATE TABLE submission_reservations (
  id UUID PRIMARY KEY,
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  team_id UUID NOT NULL REFERENCES teams(id),
  qualification_round_id UUID NOT NULL REFERENCES qualification_rounds(id),
  archive_sha256 TEXT NOT NULL CHECK (archive_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  reserved_at TIMESTAMPTZ NOT NULL,
  grace_ends_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'COMPLETED')),
  submission_id UUID UNIQUE REFERENCES submissions(id),
  completed_at TIMESTAMPTZ,
  UNIQUE (team_id, qualification_round_id, archive_sha256),
  CHECK (
    (status = 'COMPLETED' AND submission_id IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'RESERVED' AND submission_id IS NULL AND completed_at IS NULL)
  )
);

CREATE FUNCTION reject_submission_reservation_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.seq IS DISTINCT FROM OLD.seq
    OR NEW.team_id IS DISTINCT FROM OLD.team_id
    OR NEW.qualification_round_id IS DISTINCT FROM OLD.qualification_round_id
    OR NEW.archive_sha256 IS DISTINCT FROM OLD.archive_sha256
    OR NEW.reserved_at IS DISTINCT FROM OLD.reserved_at
    OR NEW.grace_ends_at IS DISTINCT FROM OLD.grace_ends_at THEN
    RAISE EXCEPTION 'submission_reservation core fields are immutable';
  END IF;

  IF OLD.status = 'COMPLETED' THEN
    IF NEW.status IS DISTINCT FROM 'COMPLETED'
      OR NEW.submission_id IS DISTINCT FROM OLD.submission_id
      OR NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN
      RAISE EXCEPTION 'completed submission_reservation is immutable';
    END IF;
  ELSIF OLD.status = 'RESERVED' THEN
    IF NEW.status = 'COMPLETED' THEN
      IF NEW.submission_id IS NULL OR NEW.completed_at IS NULL THEN
        RAISE EXCEPTION 'completing submission_reservation requires submission_id and completed_at';
      END IF;
    ELSIF NEW.status = 'RESERVED' THEN
      IF NEW.submission_id IS NOT NULL OR NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'reserved status cannot have submission_id or completed_at';
      END IF;
    ELSE
      RAISE EXCEPTION 'invalid status transition: % -> %', OLD.status, NEW.status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER submission_reservations_immutable_fields
  BEFORE UPDATE ON submission_reservations FOR EACH ROW EXECUTE FUNCTION reject_submission_reservation_mutation();

CREATE FUNCTION reject_submission_reservation_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'submission_reservation deletion is not allowed';
END;
$$;

CREATE TRIGGER submission_reservations_no_delete
  BEFORE DELETE ON submission_reservations FOR EACH ROW EXECUTE FUNCTION reject_submission_reservation_delete();

ALTER TABLE submissions ADD COLUMN qualification_round_id UUID REFERENCES qualification_rounds(id);

CREATE INDEX submissions_preflight_position_idx ON submissions (status, created_at, id);
