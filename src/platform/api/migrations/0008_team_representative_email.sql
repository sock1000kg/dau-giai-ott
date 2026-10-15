ALTER TABLE teams ADD COLUMN representative_email TEXT;
ALTER TABLE teams ADD CONSTRAINT teams_representative_email_check
  CHECK (representative_email IS NULL OR (representative_email = lower(representative_email) AND length(representative_email) <= 254));
CREATE UNIQUE INDEX teams_representative_email_idx ON teams (representative_email) WHERE representative_email IS NOT NULL;
