-- 0018 (renumbered from 0015): 0014 is the qualification gate, 0015 test runs (P3-N06), 0016 finals
-- (P3-D08) and 0017 result bundles (P3-D09). Existing matches keep their immutable v1 snapshot.
ALTER TABLE matches
  ADD COLUMN rule_set_id UUID REFERENCES round_rule_sets(id),
  ADD COLUMN protocol_v2 JSONB,
  ADD CONSTRAINT matches_protocol_v2_pair CHECK (
    (rule_set_id IS NULL AND protocol_v2 IS NULL) OR
    (rule_set_id IS NOT NULL AND protocol_v2 IS NOT NULL AND jsonb_typeof(protocol_v2) = 'object')
  );

CREATE FUNCTION reject_match_protocol_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.rule_set_id IS DISTINCT FROM OLD.rule_set_id
    OR NEW.protocol_v2 IS DISTINCT FROM OLD.protocol_v2 THEN
    RAISE EXCEPTION 'match protocol snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER matches_protocol_snapshot_immutable BEFORE UPDATE ON matches
  FOR EACH ROW EXECUTE FUNCTION reject_match_protocol_snapshot_mutation();
