-- Migration 0010: OCI Layer tracking, deduplication and duplicate review flags

CREATE TABLE oci_layers (
  digest TEXT PRIMARY KEY CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  media_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_key TEXT NOT NULL UNIQUE,
  is_base_layer BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE submission_layers (
  submission_id UUID NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  layer_digest TEXT NOT NULL REFERENCES oci_layers(digest) ON DELETE RESTRICT,
  layer_order INTEGER NOT NULL CHECK (layer_order >= 0),
  PRIMARY KEY (submission_id, layer_digest),
  UNIQUE (submission_id, layer_order)
);

CREATE INDEX submission_layers_digest_idx ON submission_layers (layer_digest);
CREATE INDEX submission_layers_submission_idx ON submission_layers (submission_id);

ALTER TABLE submissions
  ADD COLUMN duplicate_of_submission_id UUID REFERENCES submissions(id) ON DELETE SET NULL,
  ADD COLUMN duplicate_review_flag BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN duplicate_review_reason TEXT;

CREATE INDEX submissions_duplicate_review_flag_idx
  ON submissions (duplicate_review_flag) WHERE duplicate_review_flag = TRUE;

