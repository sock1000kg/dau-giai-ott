CREATE TABLE admin_mfa (
  account_id UUID PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  secret_ciphertext BYTEA NOT NULL,
  secret_iv BYTEA NOT NULL,
  secret_tag BYTEA NOT NULL,
  key_version INTEGER NOT NULL DEFAULT 1,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_step BIGINT
);

CREATE OR REPLACE FUNCTION check_admin_mfa_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role account_role;
BEGIN
  SELECT role INTO v_role FROM accounts WHERE id = NEW.account_id;
  IF v_role IS DISTINCT FROM 'BTC_ADMIN' THEN
    RAISE EXCEPTION 'Only BTC_ADMIN accounts can have admin_mfa configured';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_mfa_btc_only
  BEFORE INSERT OR UPDATE ON admin_mfa
  FOR EACH ROW EXECUTE FUNCTION check_admin_mfa_role();

CREATE TABLE admin_recovery_codes (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  code_sha256 TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  used_at TIMESTAMPTZ
);
CREATE INDEX admin_recovery_codes_account_idx ON admin_recovery_codes(account_id);

CREATE OR REPLACE FUNCTION check_admin_recovery_codes_role() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_role account_role;
BEGIN
  SELECT role INTO v_role FROM accounts WHERE id = NEW.account_id;
  IF v_role IS DISTINCT FROM 'BTC_ADMIN' THEN
    RAISE EXCEPTION 'Only BTC_ADMIN accounts can have admin recovery codes';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER admin_recovery_codes_btc_only
  BEFORE INSERT OR UPDATE ON admin_recovery_codes
  FOR EACH ROW EXECUTE FUNCTION check_admin_recovery_codes_role();
