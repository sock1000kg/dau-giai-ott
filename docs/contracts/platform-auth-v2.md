# Platform Authentication and Admin Security Contract v2

> **Status:** APPROVED policy contract for Phase 3; endpoint schemas/tests are delivered by `P3-D04` and `P3-D06`.
>
> **Compatibility:** extends v1 sessions/RBAC; no self-registration or self-service reset is added.

## Bulk team provisioning

- Only `BTC_ADMIN` may import the BTC-approved CSV.
- Every row is validated before commit; duplicate team/email/username failures identify the row and the
  operation is atomic.
- The server creates random credentials and streams one plaintext credential file exactly once. Only hashes
  persist. Plaintext must not enter database, object storage, log, metric, trace or audit.
- Retrying the same completed operation never returns the previous plaintext. Bulk reset creates new
  credentials and revokes old sessions.

## BTC multi-factor authentication

- `BTC_ADMIN` authentication is password plus TOTP, with one-time recovery codes stored hashed/encrypted as
  appropriate. Used recovery codes cannot be replayed.
- TOTP secret/recovery material never appears in client bundle, log, metric, trace or audit.
- `TEAM_ACCOUNT` keeps the v1 password/session flow unless a later approved contract changes it.

## Admin network boundary and startup guard

- Admin routes validate the effective client address only through explicitly trusted proxies and a configured
  LAN/VPN CIDR allowlist; spoofed forwarding headers are rejected/ignored.
- Dev/test may explicitly disable TOTP/allowlist. Hosted PoC and production must fail startup when TOTP is
  disabled, the allowlist is empty, or trusted-proxy configuration is ambiguous.
- Login/admin/upload/write routes have account/IP rate limits, body limits and security headers.

## Audit and failure behavior

- Audit records actor, operation, target/count, reason, correlation ID and timestamp, never secrets.
- Authentication errors do not disclose whether a username, TOTP enrollment or recovery code exists.
- Authorization remains server-side; UI visibility is never an access-control boundary.
