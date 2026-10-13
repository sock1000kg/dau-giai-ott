ALTER TABLE match_results
  ADD COLUMN faults JSONB NOT NULL DEFAULT '{"X":{"recoverableTotal":0,"recoverableConsecutive":0,"lastErrorCode":null},"O":{"recoverableTotal":0,"recoverableConsecutive":0,"lastErrorCode":null}}'::jsonb;

ALTER TABLE match_results
  ADD CONSTRAINT match_results_faults_shape CHECK (
    jsonb_typeof(faults) = 'object'
    AND faults ? 'X' AND faults ? 'O'
    AND jsonb_typeof(faults->'X') = 'object'
    AND jsonb_typeof(faults->'O') = 'object'
    AND jsonb_typeof(faults->'X'->'recoverableTotal') = 'number'
    AND jsonb_typeof(faults->'X'->'recoverableConsecutive') = 'number'
    AND jsonb_typeof(faults->'O'->'recoverableTotal') = 'number'
    AND jsonb_typeof(faults->'O'->'recoverableConsecutive') = 'number'
    AND (faults->'X'->>'recoverableTotal')::numeric >= 0
    AND (faults->'X'->>'recoverableConsecutive')::numeric >= 0
    AND (faults->'O'->>'recoverableTotal')::numeric >= 0
    AND (faults->'O'->>'recoverableConsecutive')::numeric >= 0
    AND (faults->'X'->'lastErrorCode' IS NULL OR jsonb_typeof(faults->'X'->'lastErrorCode') IN ('string', 'null'))
    AND (faults->'O'->'lastErrorCode' IS NULL OR jsonb_typeof(faults->'O'->'lastErrorCode') IN ('string', 'null'))
  );
