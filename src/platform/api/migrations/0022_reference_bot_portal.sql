ALTER TABLE test_run_reference_bots
  ADD COLUMN created_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN last_enabled_by_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN enabled_at TIMESTAMPTZ,
  ADD COLUMN disabled_at TIMESTAMPTZ,
  ADD CONSTRAINT test_run_reference_bots_display_name_length
    CHECK (char_length(display_name) BETWEEN 1 AND 80);

UPDATE test_run_reference_bots
SET enabled_at = CASE WHEN enabled THEN created_at ELSE NULL END,
    disabled_at = CASE WHEN enabled THEN NULL ELSE created_at END;

ALTER TABLE test_run_reference_bots
  ADD CONSTRAINT test_run_reference_bots_enabled_timestamps
    CHECK (NOT enabled OR (enabled_at IS NOT NULL AND disabled_at IS NULL));

CREATE UNIQUE INDEX test_run_reference_bots_archive_sha256_idx
  ON test_run_reference_bots (archive_sha256);
