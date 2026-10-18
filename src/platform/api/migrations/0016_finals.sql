-- P3-D08 finals control plane: versioned finals rule sets, locked 8-team seeding, LAN submission
-- window and cutoff pinning. Mirrors the append-only/immutability patterns of 0007_round_rules.sql
-- and the Finals Format v1 / Finals ResultBundle v1 contracts.

CREATE TABLE finals_rule_sets (
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

CREATE FUNCTION reject_finals_rule_set_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finals_rule_set is immutable';
END;
$$;
CREATE TRIGGER finals_rule_sets_immutable
  BEFORE UPDATE OR DELETE ON finals_rule_sets FOR EACH ROW EXECUTE FUNCTION reject_finals_rule_set_mutation();

CREATE TABLE finals_competitions (
  id UUID PRIMARY KEY,
  tournament_stage TEXT NOT NULL CHECK (tournament_stage ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  status TEXT NOT NULL DEFAULT 'DRAFT_RULES'
    CHECK (status IN ('DRAFT_RULES','SUBMISSION_OPEN','SUBMISSION_CLOSED','RUNNING','SETTLING','RATED','PUBLISHED')),
  rule_set_id UUID REFERENCES finals_rule_sets(id),
  bronze_match_enabled BOOLEAN NOT NULL DEFAULT true,
  draw_seed TEXT,
  seeding_hash TEXT CHECK (seeding_hash IS NULL OR seeding_hash ~ '^[0-9a-f]{64}$'),
  seeded_at TIMESTAMPTZ,
  seeded_by UUID REFERENCES accounts(id),
  submission_opens_at TIMESTAMPTZ,
  lan_cutoff_at TIMESTAMPTZ,
  cutoff_closed_at TIMESTAMPTZ,
  cutoff_idempotency_key TEXT,
  cutoff_request_hash TEXT CHECK (cutoff_request_hash IS NULL OR cutoff_request_hash ~ '^[0-9a-f]{64}$'),
  pinned_rule_set_id UUID REFERENCES finals_rule_sets(id),
  pinned_map_pool JSONB,
  pinned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_stage)
);

CREATE FUNCTION reject_finals_competition_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finals_competition deletion is not allowed';
END;
$$;
CREATE TRIGGER finals_competitions_no_delete
  BEFORE DELETE ON finals_competitions FOR EACH ROW EXECUTE FUNCTION reject_finals_competition_delete();

-- Rule set, seeding and cutoff pinning become immutable once set: a published finals ranking may not
-- be rewritten, and the pinned rule set/map pool is what the LAN event actually ran.
CREATE FUNCTION reject_finals_competition_immutable_fields() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tournament_stage IS DISTINCT FROM OLD.tournament_stage THEN
    RAISE EXCEPTION 'finals_competition tournament_stage is immutable';
  END IF;
  IF NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id AND OLD.rule_set_id IS NOT NULL THEN
    RAISE EXCEPTION 'finals_competition rule_set_id is immutable once set';
  END IF;
  IF NEW.draw_seed IS DISTINCT FROM OLD.draw_seed AND OLD.draw_seed IS NOT NULL THEN
    RAISE EXCEPTION 'finals_competition draw_seed is immutable once set';
  END IF;
  IF NEW.seeding_hash IS DISTINCT FROM OLD.seeding_hash AND OLD.seeding_hash IS NOT NULL THEN
    RAISE EXCEPTION 'finals_competition seeding_hash is immutable once set';
  END IF;
  IF NEW.pinned_at IS NOT NULL AND OLD.pinned_at IS NOT NULL THEN
    IF NEW.pinned_rule_set_id IS DISTINCT FROM OLD.pinned_rule_set_id
      OR NEW.pinned_map_pool IS DISTINCT FROM OLD.pinned_map_pool
      OR NEW.cutoff_closed_at IS DISTINCT FROM OLD.cutoff_closed_at THEN
      RAISE EXCEPTION 'finals_competition cutoff pin is immutable once closed';
    END IF;
  END IF;
  IF NEW.cutoff_idempotency_key IS DISTINCT FROM OLD.cutoff_idempotency_key
    AND OLD.cutoff_idempotency_key IS NOT NULL THEN
    RAISE EXCEPTION 'finals_competition cutoff_idempotency_key is immutable once set';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_competitions_immutable_fields
  BEFORE UPDATE ON finals_competitions FOR EACH ROW EXECUTE FUNCTION reject_finals_competition_immutable_fields();

-- Status edges are checked by `check_finals_competition_transition`, which is created after
-- `finals_seeds` because PL/pgSQL resolves table names when the function body is validated.


CREATE TABLE finals_seeds (
  competition_id UUID NOT NULL REFERENCES finals_competitions(id),
  ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 8),
  team_id UUID NOT NULL REFERENCES teams(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  elo INTEGER NOT NULL,
  series_wins INTEGER NOT NULL CHECK (series_wins >= 0),
  game_point_differential INTEGER NOT NULL,
  rated_series INTEGER NOT NULL CHECK (rated_series >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, ordinal),
  UNIQUE (competition_id, team_id),
  UNIQUE (competition_id, submission_id)
);

-- The published ranking is locked: a seed row is append-only and never rewritten (AC-09).
CREATE FUNCTION reject_finals_seed_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'finals_seed is immutable';
END;
$$;
CREATE TRIGGER finals_seeds_immutable
  BEFORE UPDATE OR DELETE ON finals_seeds FOR EACH ROW EXECUTE FUNCTION reject_finals_seed_mutation();

-- A seed row must carry a rated-series count: the service applies the published D-22 threshold
-- (which BTC may lower for short stages) and reports ineligible teams instead of seeding them.
CREATE FUNCTION check_finals_seed_rated_series() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rated_series < 1 THEN
    RAISE EXCEPTION 'finals_seed requires at least one rated series';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_seeds_rated_series
  BEFORE INSERT ON finals_seeds FOR EACH ROW EXECUTE FUNCTION check_finals_seed_rated_series();

-- Status edges are explicit, and a competition may only start running with the locked 8-team seeding
-- and a pinned rule set: that is what "chỉ eligible locked ranking được seed" means at rest.
CREATE FUNCTION check_finals_competition_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  seed_count INTEGER;
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.status = 'DRAFT_RULES' AND NEW.status = 'SUBMISSION_OPEN')
    OR (OLD.status = 'SUBMISSION_OPEN' AND NEW.status = 'SUBMISSION_CLOSED')
    OR (OLD.status = 'SUBMISSION_CLOSED' AND NEW.status = 'RUNNING')
    OR (OLD.status = 'RUNNING' AND NEW.status = 'SETTLING')
    OR (OLD.status = 'SETTLING' AND NEW.status = 'RATED')
    OR (OLD.status = 'RATED' AND NEW.status = 'PUBLISHED')
  ) THEN
    RAISE EXCEPTION 'finals_competition status transition not allowed: % -> %', OLD.status, NEW.status;
  END IF;

  IF NEW.status IN ('RUNNING', 'SETTLING', 'RATED', 'PUBLISHED') THEN
    SELECT COUNT(*) INTO seed_count FROM finals_seeds WHERE competition_id = NEW.id;
    IF seed_count <> 8 THEN
      RAISE EXCEPTION 'finals_competition requires exactly 8 locked seeds, found %', seed_count;
    END IF;
    IF NEW.seeding_hash IS NULL OR NEW.pinned_at IS NULL OR NEW.pinned_rule_set_id IS NULL THEN
      RAISE EXCEPTION 'finals_competition requires locked seeding and a pinned rule set before running';
    END IF;
  END IF;

  IF NEW.status IN ('SUBMISSION_CLOSED', 'RUNNING', 'SETTLING', 'RATED', 'PUBLISHED')
    AND NEW.cutoff_closed_at IS NULL THEN
    RAISE EXCEPTION 'finals_competition requires a closed LAN cutoff';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_competitions_status_transition
  BEFORE UPDATE ON finals_competitions FOR EACH ROW EXECUTE FUNCTION check_finals_competition_transition();

CREATE TABLE finals_series (
  id UUID PRIMARY KEY,
  competition_id UUID NOT NULL REFERENCES finals_competitions(id),
  pairing_id TEXT NOT NULL CHECK (pairing_id ~ '^(QF[1-4]|SF[12]|F1|B1)$'),
  round TEXT NOT NULL CHECK (round IN ('QUARTERFINAL','SEMIFINAL','FINAL','BRONZE')),
  slot INTEGER NOT NULL CHECK (slot > 0),
  home_seed INTEGER CHECK (home_seed BETWEEN 1 AND 8),
  away_seed INTEGER CHECK (away_seed BETWEEN 1 AND 8),
  home_team_id UUID REFERENCES teams(id),
  away_team_id UUID REFERENCES teams(id),
  series_seed TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','RUNNING','FINALIZED','CANCELLED')),
  home_games INTEGER NOT NULL DEFAULT 0 CHECK (home_games BETWEEN 0 AND 2),
  away_games INTEGER NOT NULL DEFAULT 0 CHECK (away_games BETWEEN 0 AND 2),
  winner_team_id UUID REFERENCES teams(id),
  winner_seed INTEGER CHECK (winner_seed BETWEEN 1 AND 8),
  override_audit JSONB,
  scheduled_at TIMESTAMPTZ,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (competition_id, pairing_id),
  UNIQUE (competition_id, round, slot),
  CHECK (home_team_id IS NULL OR away_team_id IS NULL OR home_team_id <> away_team_id)
);

-- Bracket rules at rest: only a FINALIZED series carries a winner, and that winner must be one of the
-- two seeds in the pairing (mirrors resolveBracket in the P3-L06 domain).
CREATE FUNCTION check_finals_series_terminal_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'FINALIZED' THEN
    IF NEW.winner_seed IS NULL OR NEW.finalized_at IS NULL THEN
      RAISE EXCEPTION 'finalized finals_series requires winner_seed and finalized_at';
    END IF;
    IF NEW.winner_seed IS DISTINCT FROM NEW.home_seed AND NEW.winner_seed IS DISTINCT FROM NEW.away_seed THEN
      RAISE EXCEPTION 'finals_series winner_seed must be one of the two seeds in the pairing';
    END IF;
  ELSIF NEW.winner_seed IS NOT NULL THEN
    RAISE EXCEPTION 'finals_series cannot report a winner before FINALIZED';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_series_terminal_consistency
  BEFORE INSERT OR UPDATE ON finals_series FOR EACH ROW EXECUTE FUNCTION check_finals_series_terminal_consistency();

CREATE TABLE finals_series_games (
  id UUID PRIMARY KEY,
  series_id UUID NOT NULL REFERENCES finals_series(id),
  game INTEGER NOT NULL CHECK (game BETWEEN 1 AND 3),
  home_side TEXT NOT NULL CHECK (home_side IN ('X','O')),
  away_side TEXT NOT NULL CHECK (away_side IN ('X','O')),
  map_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','RUNNING','FINALIZED','CANCELLED')),
  match_id UUID REFERENCES matches(id),
  winner_side TEXT CHECK (winner_side IN ('X','O')),
  decided_by TEXT CHECK (decided_by IN ('DIRECT','CRITERION','QUALIFICATION_SEED')),
  decided_criterion_id TEXT,
  score_breakdown JSONB,
  finalized_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (series_id, game),
  CHECK (home_side <> away_side),
  CHECK (status <> 'FINALIZED' OR (winner_side IS NOT NULL AND decided_by IS NOT NULL AND finalized_at IS NOT NULL))
);

-- Games 1/2 must swap sides (Finals Format v1): the service plans this from the committed series seed
-- and the table refuses a game that repeats the previous game's home side.
CREATE FUNCTION check_finals_game_side_swap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous finals_series_games;
BEGIN
  SELECT * INTO previous FROM finals_series_games
    WHERE series_id = NEW.series_id AND game = NEW.game - 1;
  IF previous.id IS NOT NULL AND previous.home_side = NEW.home_side THEN
    RAISE EXCEPTION 'finals_series_games must swap sides between consecutive games';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_series_games_side_swap
  BEFORE INSERT ON finals_series_games FOR EACH ROW EXECUTE FUNCTION check_finals_game_side_swap();

CREATE FUNCTION reject_finalized_game_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'FINALIZED' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'finalized finals_series_game is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_series_games_finalized_immutable
  BEFORE UPDATE ON finals_series_games FOR EACH ROW EXECUTE FUNCTION reject_finalized_game_mutation();

-- LAN submission pins: the last LAN upload before the cutoff wins, and the qualification ACTIVE
-- fallback is only allowed when that artifact is compatible with the pinned finals rule set.
CREATE TABLE finals_submission_pins (
  competition_id UUID NOT NULL REFERENCES finals_competitions(id),
  team_id UUID NOT NULL REFERENCES teams(id),
  submission_id UUID NOT NULL REFERENCES submissions(id),
  source TEXT NOT NULL CHECK (source IN ('LAN','QUALIFICATION_ACTIVE')),
  artifact_sha256 TEXT NOT NULL CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  compatible BOOLEAN NOT NULL,
  pinned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (competition_id, team_id)
);

CREATE FUNCTION check_finals_submission_pin_compatibility() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT NEW.compatible THEN
    IF NEW.source = 'QUALIFICATION_ACTIVE' THEN
      RAISE EXCEPTION 'qualification fallback requires a compatible artifact';
    END IF;
    RAISE EXCEPTION 'LAN submission must pass preflight compatibility';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER finals_submission_pins_compatibility
  BEFORE INSERT OR UPDATE ON finals_submission_pins FOR EACH ROW EXECUTE FUNCTION check_finals_submission_pin_compatibility();

CREATE INDEX finals_seeds_competition_idx ON finals_seeds (competition_id, ordinal);
CREATE INDEX finals_series_competition_idx ON finals_series (competition_id, round, slot);
CREATE INDEX finals_series_games_series_idx ON finals_series_games (series_id, game);
CREATE INDEX finals_submission_pins_competition_idx ON finals_submission_pins (competition_id);
