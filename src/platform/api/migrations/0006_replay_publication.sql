CREATE TYPE replay_publication_state AS ENUM ('PRIVATE', 'STAGED', 'PUBLISHED');

CREATE TABLE replay_publications (
  match_id UUID PRIMARY KEY REFERENCES matches(id) ON DELETE RESTRICT,
  state replay_publication_state NOT NULL DEFAULT 'PRIVATE',
  event_log_key TEXT NOT NULL,
  event_log_sha256 TEXT NOT NULL CHECK (event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  staged_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  CHECK (event_log_key ~ ('^match-results/' || match_id::text || '/event-log/sha256:[0-9a-f]{64}\.json$')),
  CHECK ((state = 'PRIVATE' AND staged_at IS NULL AND published_at IS NULL)
    OR (state = 'STAGED' AND staged_at IS NOT NULL AND published_at IS NULL)
    OR (state = 'PUBLISHED' AND staged_at IS NOT NULL AND published_at IS NOT NULL))
);

CREATE FUNCTION enforce_replay_publication_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.match_id IS DISTINCT FROM OLD.match_id
    OR NEW.event_log_key IS DISTINCT FROM OLD.event_log_key
    OR NEW.event_log_sha256 IS DISTINCT FROM OLD.event_log_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'replay identity is immutable';
  END IF;

  IF OLD.state = 'PRIVATE' AND NEW.state = 'STAGED' THEN
    NEW.staged_at := now();
    NEW.published_at := NULL;
  ELSIF OLD.state = 'STAGED' AND NEW.state = 'PUBLISHED' THEN
    NEW.staged_at := OLD.staged_at;
    NEW.published_at := now();
  ELSE
    RAISE EXCEPTION 'invalid replay publication transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER replay_publications_update_guard
  BEFORE UPDATE ON replay_publications FOR EACH ROW EXECUTE FUNCTION enforce_replay_publication_update();

CREATE FUNCTION reject_replay_publication_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'replay publication history is immutable';
END;
$$;

CREATE TRIGGER replay_publications_delete_guard
  BEFORE DELETE ON replay_publications FOR EACH ROW EXECUTE FUNCTION reject_replay_publication_delete();

CREATE FUNCTION validate_private_replay_publication_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  match_status match_status;
  stored_event_log_key TEXT;
  stored_event_log_sha256 TEXT;
BEGIN
  IF NEW.state <> 'PRIVATE' THEN
    RAISE EXCEPTION 'replay publication must start private';
  END IF;
  SELECT m.status, r.event_log_key, r.event_log_sha256
    INTO match_status, stored_event_log_key, stored_event_log_sha256
    FROM matches m
    LEFT JOIN match_results r ON r.match_id = m.id
    WHERE m.id = NEW.match_id;
  IF match_status <> 'FINALIZED'
    OR stored_event_log_sha256 IS DISTINCT FROM NEW.event_log_sha256
    OR stored_event_log_key IS DISTINCT FROM NEW.event_log_key THEN
    RAISE EXCEPTION 'replay publication requires a finalized verified replay identity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER replay_publications_insert_guard
  BEFORE INSERT ON replay_publications FOR EACH ROW EXECUTE FUNCTION validate_private_replay_publication_insert();

CREATE FUNCTION ensure_private_replay_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  candidate_match_id UUID;
  candidate_status match_status;
  candidate_event_log_key TEXT;
  candidate_event_log_sha256 TEXT;
BEGIN
  candidate_match_id := COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(NEW)->>'match_id')::uuid);
  SELECT m.status, r.event_log_key, r.event_log_sha256
    INTO candidate_status, candidate_event_log_key, candidate_event_log_sha256
    FROM matches m
    JOIN match_results r ON r.match_id = m.id
    WHERE m.id = candidate_match_id;

  IF candidate_status = 'FINALIZED'
    AND candidate_event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'
    AND candidate_event_log_key = 'match-results/' || candidate_match_id::text || '/event-log/' || candidate_event_log_sha256 || '.json' THEN
    INSERT INTO replay_publications (match_id, state, event_log_key, event_log_sha256)
    VALUES (candidate_match_id, 'PRIVATE', candidate_event_log_key, candidate_event_log_sha256)
    ON CONFLICT (match_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER finalized_match_replay_publication
  AFTER UPDATE OF status ON matches FOR EACH ROW
  WHEN (NEW.status = 'FINALIZED' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION ensure_private_replay_publication();

CREATE TRIGGER finalized_result_replay_publication
  AFTER INSERT ON match_results FOR EACH ROW
  EXECUTE FUNCTION ensure_private_replay_publication();

INSERT INTO replay_publications (match_id, state, event_log_key, event_log_sha256)
SELECT m.id, 'PRIVATE', r.event_log_key, r.event_log_sha256
FROM matches m
JOIN match_results r ON r.match_id = m.id
WHERE m.status = 'FINALIZED'
  AND r.event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'
  AND r.event_log_key = 'match-results/' || m.id::text || '/event-log/' || r.event_log_sha256 || '.json'
ON CONFLICT (match_id) DO NOTHING;

CREATE TABLE replay_publication_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES replay_publications(match_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('STAGE', 'PUBLISH')),
  resulting_state replay_publication_state NOT NULL CHECK (resulting_state IN ('STAGED', 'PUBLISHED')),
  idempotency_key TEXT NOT NULL UNIQUE CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  actor_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 500),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((action = 'STAGE' AND resulting_state = 'STAGED')
    OR (action = 'PUBLISH' AND resulting_state = 'PUBLISHED'))
);
CREATE INDEX replay_publication_events_match_idx
  ON replay_publication_events (match_id, created_at, id);

CREATE FUNCTION reject_replay_publication_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'replay publication audit is immutable';
END;
$$;

CREATE TRIGGER replay_publication_events_update_guard
  BEFORE UPDATE OR DELETE ON replay_publication_events FOR EACH ROW EXECUTE FUNCTION reject_replay_publication_event_mutation();
