-- P3-D09 signed ResultBundle import: canonicalized envelopes, allowlisted public keys and
-- all-or-nothing publication. The manifest is UTF-8 JSON canonicalized with RFC 8785 before the
-- Ed25519 signature is produced offline (see docs/contracts/finals-result-bundle-v1.md).

CREATE TABLE result_bundle_keys (
  key_id TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm = 'Ed25519'),
  public_key_pem TEXT NOT NULL,
  allowlisted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE result_bundles (
  bundle_id TEXT NOT NULL CHECK (length(bundle_id) BETWEEN 1 AND 128),
  bundle_version INTEGER NOT NULL CHECK (bundle_version > 0),
  tournament_id TEXT NOT NULL,
  finals_rule_set_id TEXT NOT NULL,
  key_id TEXT NOT NULL REFERENCES result_bundle_keys(key_id),
  manifest JSONB NOT NULL,
  manifest_sha256 TEXT NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  signature TEXT NOT NULL,
  correction_of_bundle_id TEXT,
  correction_of_bundle_version INTEGER CHECK (correction_of_bundle_version IS NULL OR correction_of_bundle_version > 0),
  correction_reason TEXT,
  status TEXT NOT NULL CHECK (status IN ('IMPORTED', 'VERIFIED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at TIMESTAMPTZ,
  PRIMARY KEY (bundle_id, bundle_version),
  CHECK ((correction_of_bundle_id IS NULL) = (correction_reason IS NULL)),
  CHECK ((correction_of_bundle_id IS NULL) = (correction_of_bundle_version IS NULL)),
  CHECK (status <> 'VERIFIED' OR verified_at IS NOT NULL)
);

-- A corrected bundle must be a higher version of a bundle that already exists, and must carry a reason.
CREATE FUNCTION check_result_bundle_correction() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.correction_of_bundle_id IS NOT NULL THEN
    IF NEW.correction_of_bundle_version >= NEW.bundle_version THEN
      RAISE EXCEPTION 'corrected result bundle must use a higher bundle_version';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM result_bundles previous
      WHERE previous.bundle_id = NEW.correction_of_bundle_id
        AND previous.bundle_version = NEW.correction_of_bundle_version
    ) THEN
      RAISE EXCEPTION 'corrected result bundle base version does not exist';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER result_bundles_correction
  BEFORE INSERT ON result_bundles FOR EACH ROW EXECUTE FUNCTION check_result_bundle_correction();

-- Bundles and their artifacts are append-only; only the publication status may move to VERIFIED.
CREATE FUNCTION reject_result_bundle_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'result_bundle deletion is not allowed';
  END IF;
  IF OLD.status = 'VERIFIED' THEN
    RAISE EXCEPTION 'verified result bundle is immutable';
  END IF;
  IF NEW.bundle_id IS DISTINCT FROM OLD.bundle_id
    OR NEW.bundle_version IS DISTINCT FROM OLD.bundle_version
    OR NEW.manifest IS DISTINCT FROM OLD.manifest
    OR NEW.manifest_sha256 IS DISTINCT FROM OLD.manifest_sha256
    OR NEW.signature IS DISTINCT FROM OLD.signature
    OR NEW.key_id IS DISTINCT FROM OLD.key_id
    OR NEW.status = 'IMPORTED' THEN
    RAISE EXCEPTION 'result_bundle is immutable except for publication';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER result_bundles_immutable
  BEFORE UPDATE OR DELETE ON result_bundles FOR EACH ROW EXECUTE FUNCTION reject_result_bundle_mutation();

CREATE TABLE result_bundle_artifacts (
  bundle_id TEXT NOT NULL,
  bundle_version INTEGER NOT NULL,
  path TEXT NOT NULL CHECK (path <> '' AND path !~ '(^/)|(^\.\.)|(/\.\./)'),
  media_type TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  bytes BIGINT NOT NULL CHECK (bytes >= 0),
  content BYTEA,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (bundle_id, bundle_version, path),
  FOREIGN KEY (bundle_id, bundle_version) REFERENCES result_bundles(bundle_id, bundle_version)
);

CREATE FUNCTION reject_result_bundle_artifact_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'result_bundle_artifact is immutable';
END;
$$;
CREATE TRIGGER result_bundle_artifacts_immutable
  BEFORE UPDATE OR DELETE ON result_bundle_artifacts FOR EACH ROW EXECUTE FUNCTION reject_result_bundle_artifact_mutation();

-- No partial publication: a bundle may only become VERIFIED at commit time when every artifact the
-- manifest declares is already stored.
CREATE FUNCTION check_result_bundle_verified() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  declared INTEGER;
  stored INTEGER;
BEGIN
  IF NEW.status <> 'VERIFIED' THEN
    RETURN NEW;
  END IF;
  declared := COALESCE(jsonb_array_length(NEW.manifest -> 'artifacts'), 0);
  SELECT COUNT(*) INTO stored FROM result_bundle_artifacts
    WHERE bundle_id = NEW.bundle_id AND bundle_version = NEW.bundle_version;
  IF stored <> declared THEN
    RAISE EXCEPTION 'result_bundle cannot be published: % of % artifacts stored', stored, declared;
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER result_bundles_verified_artifacts
  AFTER INSERT OR UPDATE ON result_bundles
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_result_bundle_verified();

CREATE INDEX result_bundles_tournament_idx ON result_bundles (tournament_id, status);
CREATE INDEX result_bundle_artifacts_bundle_idx ON result_bundle_artifacts (bundle_id, bundle_version);
