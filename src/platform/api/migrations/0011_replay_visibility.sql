-- Migration 0011: Replay visibility stage guard
-- Adds a BEFORE UPDATE trigger on replay_publications to enforce that
-- PRIVATE->STAGED and STAGED->PUBLISHED transitions are only allowed
-- when the match's series tournament_stage is 'FINALS'.

CREATE FUNCTION enforce_replay_publication_stage_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  match_stage TEXT;
BEGIN
  -- Only guard the forward transitions that make a replay more visible
  IF OLD.state = 'PRIVATE' AND NEW.state = 'STAGED'
     OR OLD.state = 'STAGED' AND NEW.state = 'PUBLISHED' THEN
    -- Look up the match's series tournament_stage
    SELECT s.tournament_stage
      INTO match_stage
      FROM matches m
      JOIN series s ON s.id = m.series_id
     WHERE m.id = NEW.match_id;

    IF match_stage IS DISTINCT FROM 'FINALS' THEN
      RAISE EXCEPTION 'replay publication requires FINALS stage'
        USING ERRCODE = 'P0001';  -- SQLSTATE for raise_exception
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER replay_publications_stage_guard
  BEFORE UPDATE ON replay_publications FOR EACH ROW EXECUTE FUNCTION enforce_replay_publication_stage_guard();