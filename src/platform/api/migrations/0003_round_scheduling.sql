CREATE TABLE rounds (
  id UUID PRIMARY KEY,
  tournament_stage TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  schedule_seed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'FINALIZED')),
  rating_snapshot JSONB NOT NULL CHECK (jsonb_typeof(rating_snapshot) = 'array'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalized_at TIMESTAMPTZ,
  UNIQUE (tournament_stage, idempotency_key)
);

ALTER TABLE series
  ADD COLUMN round_id UUID REFERENCES rounds(id),
  ADD COLUMN team_a_id UUID REFERENCES teams(id),
  ADD COLUMN team_b_id UUID REFERENCES teams(id),
  ADD COLUMN format TEXT NOT NULL DEFAULT 'BO2' CHECK (format = 'BO2'),
  ADD COLUMN team_a_score NUMERIC(2,1),
  ADD COLUMN team_b_score NUMERIC(2,1),
  ADD COLUMN winner_team_id UUID REFERENCES teams(id),
  ADD COLUMN cancellation_reason TEXT CHECK (cancellation_reason IN ('MATCH_CANCELLED', 'INFRASTRUCTURE_FAILURE')),
  ADD COLUMN finalized_at TIMESTAMPTZ,
  ADD CONSTRAINT series_distinct_teams CHECK (team_a_id IS NULL OR team_b_id IS NULL OR team_a_id <> team_b_id),
  ADD CONSTRAINT series_scores_valid CHECK ((team_a_score IS NULL AND team_b_score IS NULL) OR (team_a_score BETWEEN 0 AND 2 AND team_b_score BETWEEN 0 AND 2 AND team_a_score + team_b_score = 2));

CREATE INDEX series_round_idx ON series (round_id, status);
CREATE UNIQUE INDEX series_unique_round_pair_idx
  ON series (round_id, LEAST(team_a_id, team_b_id), GREATEST(team_a_id, team_b_id))
  WHERE round_id IS NOT NULL AND team_a_id IS NOT NULL AND team_b_id IS NOT NULL;

CREATE TABLE round_participants (
  round_id UUID NOT NULL REFERENCES rounds(id),
  series_id UUID REFERENCES series(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  assignment TEXT NOT NULL CHECK (assignment IN ('PAIRED', 'BYE')),
  series_slot CHAR(1) CHECK (series_slot IN ('A', 'B')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (round_id, team_id),
  UNIQUE (series_id, series_slot),
  CHECK ((assignment = 'BYE' AND series_id IS NULL AND series_slot IS NULL)
    OR (assignment = 'PAIRED' AND series_id IS NOT NULL AND series_slot IS NOT NULL))
);
CREATE INDEX round_participants_byes_idx ON round_participants (team_id, created_at DESC) WHERE assignment = 'BYE';

CREATE FUNCTION reject_round_participant_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'round participant assignment is immutable';
END;
$$;
CREATE TRIGGER round_participants_immutable
  BEFORE UPDATE ON round_participants FOR EACH ROW EXECUTE FUNCTION reject_round_participant_mutation();

UPDATE matches SET map_checksum = map_definition->>'checksum' WHERE map_checksum IS NULL;
ALTER TABLE matches
  ALTER COLUMN map_checksum SET DEFAULT 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  ALTER COLUMN map_checksum SET NOT NULL,
  ADD COLUMN game_number SMALLINT CHECK (game_number IN (1, 2)),
  ADD CONSTRAINT matches_unique_series_game UNIQUE (series_id, game_number),
  ADD CONSTRAINT matches_map_checksum_matches_definition CHECK (map_checksum = map_definition->>'checksum');

CREATE FUNCTION reject_round_schedule_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tournament_stage IS DISTINCT FROM OLD.tournament_stage
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.request_hash IS DISTINCT FROM OLD.request_hash
    OR NEW.schedule_seed IS DISTINCT FROM OLD.schedule_seed
    OR NEW.rating_snapshot IS DISTINCT FROM OLD.rating_snapshot THEN
    RAISE EXCEPTION 'round schedule snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER rounds_schedule_snapshot_immutable
  BEFORE UPDATE ON rounds FOR EACH ROW EXECUTE FUNCTION reject_round_schedule_snapshot_mutation();

CREATE FUNCTION reject_series_schedule_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tournament_stage IS DISTINCT FROM OLD.tournament_stage
    OR NEW.round_id IS DISTINCT FROM OLD.round_id
    OR NEW.team_a_id IS DISTINCT FROM OLD.team_a_id
    OR NEW.team_b_id IS DISTINCT FROM OLD.team_b_id
    OR NEW.format IS DISTINCT FROM OLD.format THEN
    RAISE EXCEPTION 'series schedule snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER series_schedule_snapshot_immutable
  BEFORE UPDATE ON series FOR EACH ROW EXECUTE FUNCTION reject_series_schedule_snapshot_mutation();

CREATE FUNCTION reject_match_game_number_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.game_number IS DISTINCT FROM OLD.game_number THEN
    RAISE EXCEPTION 'match game number is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_game_number_immutable
  BEFORE UPDATE ON matches FOR EACH ROW EXECUTE FUNCTION reject_match_game_number_mutation();
