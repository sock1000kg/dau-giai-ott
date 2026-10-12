ALTER TABLE matches
  ADD COLUMN engine_version TEXT NOT NULL DEFAULT '1.0.0',
  ADD COLUMN map_definition JSONB NOT NULL DEFAULT '{"schemaVersion":1,"mapId":"default","version":1,"checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","width":9,"height":9,"obstacles":[],"spawns":[{"id":"X-ROCK-1","owner":"X","type":"ROCK","position":{"col":0,"row":3}},{"id":"X-ROCK-2","owner":"X","type":"ROCK","position":{"col":1,"row":2}},{"id":"X-ROCK-3","owner":"X","type":"ROCK","position":{"col":2,"row":1}},{"id":"X-PAPER-1","owner":"X","type":"PAPER","position":{"col":1,"row":3}},{"id":"X-PAPER-2","owner":"X","type":"PAPER","position":{"col":2,"row":2}},{"id":"X-PAPER-3","owner":"X","type":"PAPER","position":{"col":3,"row":1}},{"id":"X-SCISSORS-1","owner":"X","type":"SCISSORS","position":{"col":0,"row":2}},{"id":"X-SCISSORS-2","owner":"X","type":"SCISSORS","position":{"col":1,"row":1}},{"id":"X-SCISSORS-3","owner":"X","type":"SCISSORS","position":{"col":2,"row":0}},{"id":"O-ROCK-1","owner":"O","type":"ROCK","position":{"col":8,"row":5}},{"id":"O-ROCK-2","owner":"O","type":"ROCK","position":{"col":7,"row":6}},{"id":"O-ROCK-3","owner":"O","type":"ROCK","position":{"col":6,"row":7}},{"id":"O-PAPER-1","owner":"O","type":"PAPER","position":{"col":7,"row":5}},{"id":"O-PAPER-2","owner":"O","type":"PAPER","position":{"col":6,"row":6}},{"id":"O-PAPER-3","owner":"O","type":"PAPER","position":{"col":5,"row":7}},{"id":"O-SCISSORS-1","owner":"O","type":"SCISSORS","position":{"col":8,"row":6}},{"id":"O-SCISSORS-2","owner":"O","type":"SCISSORS","position":{"col":7,"row":7}},{"id":"O-SCISSORS-3","owner":"O","type":"SCISSORS","position":{"col":6,"row":8}}],"goals":{"X":{"col":8,"row":8},"O":{"col":0,"row":0}}}'::jsonb,
  ADD COLUMN max_turns INTEGER NOT NULL DEFAULT 200 CHECK (max_turns > 0),
  ADD COLUMN turn_timeout_ms INTEGER NOT NULL DEFAULT 3000 CHECK (turn_timeout_ms > 0);

ALTER TABLE match_attempts
  ADD COLUMN lease_token UUID,
  ADD COLUMN lease_expires_at TIMESTAMPTZ;

CREATE FUNCTION reject_match_execution_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.series_id IS DISTINCT FROM OLD.series_id
    OR NEW.x_submission_id IS DISTINCT FROM OLD.x_submission_id
    OR NEW.o_submission_id IS DISTINCT FROM OLD.o_submission_id
    OR NEW.map_checksum IS DISTINCT FROM OLD.map_checksum
    OR NEW.map_definition IS DISTINCT FROM OLD.map_definition
    OR NEW.seed IS DISTINCT FROM OLD.seed
    OR NEW.engine_version IS DISTINCT FROM OLD.engine_version
    OR NEW.max_turns IS DISTINCT FROM OLD.max_turns
    OR NEW.turn_timeout_ms IS DISTINCT FROM OLD.turn_timeout_ms
    OR NEW.policy_version IS DISTINCT FROM OLD.policy_version THEN
    RAISE EXCEPTION 'match execution snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_execution_snapshot_immutable
  BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION reject_match_execution_snapshot_mutation();

CREATE INDEX match_attempts_active_lease_idx
  ON match_attempts (match_id, lease_expires_at)
  WHERE status = 'RUNNING';

CREATE TABLE match_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispatched_at TIMESTAMPTZ,
  UNIQUE (match_id, event_type)
);
CREATE INDEX match_outbox_pending_idx ON match_outbox (created_at, id) WHERE dispatched_at IS NULL;
