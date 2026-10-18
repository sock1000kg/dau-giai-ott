# @ott/platform-api

Control-plane foundation for Phase 2. `P2-T03` owns PostgreSQL migrations and the typed database boundary. `P2-T04` adds a Fastify authentication/RBAC foundation: Argon2id password verification, opaque Redis-backed session cookies, server-side team ownership guards, login rate limiting and a local-env BTC bootstrap function. The public HTTP contract and local bootstrap variable documentation remain owned by `P2-T05`.

## Local database verification

Start the P2-T02 local services, export `DATABASE_URL` from an uncommitted local environment file, then run:

```bash
npm run db:migrate
npm test --workspace @ott/platform-api -- --run tests/db/schema.test.ts
```

`runMigrations` records a SHA-256 checksum for each migration. Editing an already applied migration fails deliberately; add a later migration instead. The integration test resets only its local `public` schema before it applies migrations.

## Authentication integration verification

Start PostgreSQL and Redis from P2-T02, then provide uncommitted local connection URLs:

```bash
DATABASE_URL=postgresql://... REDIS_URL=redis://:...@127.0.0.1:6379 \
  npm test --workspace @ott/platform-api -- --run tests/auth.integration.test.ts
```

The test resets the local `public` schema and Redis database. Do not point these URLs at a shared or production service.

## Match queue integration

`P2-T09` publishes only a validated `MatchJobV1` to BullMQ queue
`ott.match.v1`, with `jobId=match-<match UUID>`. Jobs get three attempts with
exponential backoff starting at one second; completed and failed jobs remain
retained so a duplicate cannot silently replace pinned OCI references. See
[`@ott/platform-worker`](../worker/README.md) for worker and Redis integration
verification.

## Qualification scheduling

`P2-T12` snapshots active submissions and current ratings from PostgreSQL and
generates/persists the private round seed server-side,
creates each BO2 round/series and its two X/O-swapped matches transactionally,
and stores validated `MatchJobV1` payloads in the `MATCH_SCHEDULED` outbox.
Call `dispatchScheduledMatches` with a `MatchQueue`-compatible enqueuer to
publish pending jobs; replay after a queue/DB interruption is idempotent.
`settleSeries` waits for both matches to be terminal, records a draw/win score
once, and cancels a series containing an infrastructure failure without
assigning a result score. A later round is held until P2-T13 has applied both
rating-ledger entries for every finalized prior series; cancelled series need
no Elo entries. Only one round per stage may be open at a time.

`P2-T13A` applies Elo only after the entire round is terminal. Every finalized
series uses that round's frozen rating snapshot, K=32, and integer zero-sum
rounding; infrastructure-cancelled series are skipped. `applyRoundRatings` is
transactional and retry-safe, while `rebuildRatingLedger` reconstructs missing
rows from immutable round snapshots and terminal series results without
rewriting existing history. Migration `0004_round_rating_application` records
the atomic round-application marker.

The public `GET /api/v1/leaderboard?stage=QUALIFICATION&page=1&pageSize=25`
returns only participating teams and public standings: rank, team ID/name,
rating, series W/D/L, win rate, head-to-head points, technical-fault/forfeit
counts and update time. Ordering is Elo descending, head-to-head points among
the same-Elo cohort descending, win rate descending, then combined technical
faults/forfeits ascending. Teams still tied share the same rank and return
`tieBreakStatus: "BTC_REQUIRED"`; UUID is only a stable display/pagination
order, not an official contest tie-break. The requirement's BTC-decided match
or seeded public draw remains a separate, auditable competition decision.
Pagination is bounded to page 1–10000 and page size 1–100.

`P2-T13C` exposes authenticated `GET /api/v1/results/matches` and
`GET /api/v1/results/series`. Team accounts are always scoped server-side to
their own team; attempting to filter another team returns 403. BTC accounts
may browse all participating teams or filter by `teamId`. Both endpoints list
terminal outcomes only, order newest terminal result first with UUID as a
stable final key, validate bounded `page`/`pageSize`, and omit private seeds,
storage object keys, event-log keys and submission archive references.
Match rows also expose the runner's fault summary for X and O
(`recoverableTotal`, `recoverableConsecutive`, `lastErrorCode`), without raw bot
output or private artifact data.

Run rating logic and PostgreSQL integration tests against a disposable database
with the API migrations applied:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/ratings.test.ts
```

Run the scheduler integration test only against a disposable PostgreSQL DB
with migrations applied; it creates and removes only its own unique fixture:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/scheduling.logic.test.ts tests/scheduling.integration.test.ts
```

`P2-T23` adds migration `0006_replay_publication` and a PostgreSQL repository for
BTC replay catalog and publication state. A verified terminal match gets exactly
one `PRIVATE` publication row; database guards only permit `PRIVATE → STAGED →
PUBLISHED`, preserve the content-addressed replay identity, and keep actor,
reason, timestamp, and idempotency key in append-only audit rows. The repository
requires an active `BTC_ADMIN` and the caller's byte-verified SHA-256 to match
the finalized result identity. `P2-T24` must verify the private object bytes
through storage before calling these transition functions; this repository
does not itself read the object store or expose its key in catalog results.

Run the T23 integration test only against a disposable PostgreSQL database. It
creates a random schema, applies the migrations there, and drops only that
schema during teardown:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/replay-publication-repository.integration.test.ts
```

`P2-T24` exposes BTC-only `GET /api/v1/admin/replays/catalog` and idempotent
stage/publish POST routes plus anonymous
`GET /api/v1/public/replays/:matchId`. Before each transition and public read,
the API loads the storage key from PostgreSQL, reads the private object, checks
the exact bytes against the stored SHA-256, and parses event-log v1. Public
responses are an allowlisted `ott.spectator-replay` v1 projection with the
source seed and private key omitted. `X-Replay-SHA256` hashes the exact public
response bytes; see [Spectator Replay API v1](../../../docs/contracts/spectator-replay-v1.md)
for the wire contract.

Run the T24 integration test against disposable PostgreSQL and a local Redis;
it uses SeaweedFS when the S3 environment variables are set and otherwise uses
an in-memory object-storage adapter. PostgreSQL fixtures use a random schema;
Redis keys and object keys are unique to the test:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" REDIS_URL="$YOUR_LOCAL_REDIS_URL" \
  S3_ENDPOINT="$YOUR_LOCAL_S3_ENDPOINT" S3_BUCKET="$YOUR_TEST_BUCKET" \
  S3_ACCESS_KEY_ID="$YOUR_LOCAL_S3_ACCESS_KEY" S3_SECRET_ACCESS_KEY="$YOUR_LOCAL_S3_SECRET_KEY" \
  npm test --workspace @ott/platform-api -- --run tests/replays.integration.test.ts
```

## Versioned round rule sets and round lifecycle (`P3-D01`)

`POST /api/v1/admin/round-rule-sets` persists an immutable
`round_rule_sets` version (`migrations/0007_round_rules.sql`): every save
creates a new `version` for the same `tournament_stage`, even when the
canonical-JSON `rules_sha256` is unchanged, and an UPDATE/DELETE trigger
rejects any later edit (AC1). Rules are validated by the strict
`RoundRuleSetRulesV1` validator in `src/modules/rounds/types.ts` (unknown
keys, `NONE`/30s per-turn modes and out-of-bounds values are rejected).

`qualification_rounds` drives the lifecycle state machine
`DRAFT_RULES → SUBMISSION_OPEN → SUBMISSION_CLOSED → RUNNING → SETTLING →
RATED → PUBLISHED`. `POST /api/v1/admin/rounds` creates the draft; `POST
/api/v1/admin/rounds/:id/{open|close|start|pause|resume|reconcile|publish}`
applies one transition per request with a 1–500 char `reason` (except
`reconcile`). Every transition locks the round row `FOR UPDATE`, re-checks
the edge in service and in a DB trigger, and writes exactly one audit row
in the same transaction. A round past `SUBMISSION_OPEN` can no longer
change its rule set: `rule_set_id` is written once at `open` and is
immutable afterwards.

`start` requires the `Idempotency-Key` header (1–200 chars) and body
`{ruleSetId, reason}`; the request hash is `sha256({roundId, ruleSetId})`.
Same key + same hash replays the stored result (`replayed: true`, no second
schedule or audit); same key + different hash → `IDEMPOTENCY_KEY_REUSED`.
`start` freezes the schedule snapshot by calling `scheduleRound`, which
keeps its own Phase 2 transaction (AC2). `reconcile` moves `RUNNING →
SETTLING` only when every linked series is terminal, then applies
`applyRoundRatings` exactly once before `SETTLING → RATED` (AC3).

Routes are BTC-admin only (`requireRole(requireAuthenticated(...),
'BTC_ADMIN')`) and registered in `createAuthApp` with no storage
dependency. Stable error codes: `ROUND_TRANSITION_INVALID` (409),
`RULE_SET_NOT_FOUND` (404), `RULE_SET_STAGE_MISMATCH` (409),
`ROUND_ALREADY_EXISTS_IN_STAGE` (409), `IDEMPOTENCY_KEY_INVALID` (400),
`IDEMPOTENCY_KEY_REUSED` (409), `INVALID_REASON`/`RULE_SET_INVALID`/
`TOURNAMENT_STAGE_INVALID` (400), `ROUND_NOT_FOUND` (404).

Notes: `pause` only records state and an audit row — actual queue
admission stop belongs to `P3-N02`. Submission uploads are not yet gated by
this lifecycle (`P3-D03`). Deadline extension ("gia hạn") is not part of
`P3-D01`.

## Rule-set catalog and match snapshot wiring (`P3-D25`)

The locked `RoundRuleSet` now drives the matches that `start` schedules.
What the existing `matches` columns can carry is wired: `engine_version`,
`map_definition` + `map_checksum`, `max_turns` and `turn_timeout_ms`. Full
Protocol v2 time control (job contract, worker, BotProcess v2) and the
`resources` block are **not** wired yet (follow-up L02b).

- **Registry** (`src/modules/rounds/catalog.ts`): `ENGINE_VERSIONS` (the
  game-core `ENGINE_VERSION`), `MAP_REGISTRY` (built from `DEFAULT_MAP`) and
  `FAULT_POLICY_VERSIONS` (`P2_BASELINE_V1`). Adding an engine, map or fault
  policy = adding one entry to the matching list; no other code change. The
  default map's checksum is a placeholder (`'a' * 64`), not a content hash.
- **Validation**: `createRuleSet` runs `validateAgainstCatalog` after the
  structural validator. `400 RULE_SET_INVALID` `details[]` (`{path, code}`)
  adds `UNKNOWN_ENGINE_VERSION`, `UNKNOWN_MAP` (`mapSet[i].mapId` or
  `.checksum`), `UNKNOWN_FAULT_POLICY`, `MAX_TURNS_EXCEEDS_RUNNER_LIMIT`
  (above `DEFAULT_LIMITS.maxTurns`) and `TURN_LIMIT_EXCEEDS_RUNNER_LIMIT`
  (`fixedMs`/`maxMs` above `DEFAULT_LIMITS.turnTimeoutMs`).
- **Start**: `executeStart` re-reads the locked rule set, checks its hash and
  resolves it through the registry; failure is `409 ROUND_RULESET_UNRESOLVABLE`
  before any write. `scheduleRound` receives `matchRules` and inserts the
  columns above; without `matchRules` the migration defaults apply.
  `request_hash` includes `matchRules`, so replaying a schedule with
  different rules is `SCHEDULE_IDEMPOTENCY_CONFLICT`.
- **Interim turn timeout**: the v1 job carries a single timeout, so
  `turn_timeout_ms` is the *maximum* per-turn limit of the rule set (FIXED →
  `fixedMs`, DYNAMIC → `maxMs`). Dynamic budgets arrive with L02b.
- **Map per series**: the map index is
  `int(sha256(scheduleSeed:seriesId:map)[0..8]) % maps.length`, so maps vary
  across series but **both games of a series use the same map** (side-swap
  fairness).
- `GET /api/v1/admin/rounds/catalog` (BTC_ADMIN; 401/403 otherwise) returns
  `{ data: { engineVersions, maps: [{ mapId, version, checksum, width, height }], faultPolicyVersions } }`
  with no map definitions or spawns. It is registered before
  `/rounds/:roundId`.

## Admin round-rule and operations console (`P3-D02`)

Small additive UI-serving changes on the D01 module (no migration, no
transition-logic change):

- `GET /api/v1/admin/round-rule-sets/:ruleSetId` now also returns `rules`
  (the stored JSONB) and `tournamentStage`. The list endpoint stays
  summary-only.
- `POST /api/v1/admin/round-rule-sets` with invalid rules returns
  `400 { error: { code: 'RULE_SET_INVALID', message, details } }` where
  `details` is `ValidationError[]` (`{ path, code }` from
  `validateRoundRuleSetRules`; no submitted values are echoed).
  `createRuleSet` throws the typed `RuleSetInvalidError` carrying the
  errors; success behaviour is unchanged.
- Round JSON (`GET /rounds`, `GET /rounds/:id`, every transition response)
  now carries `allowedActions: RoundAction[]` computed server-side from
  `status` (+ `pausedAt`: `pause` only when not paused, `resume` only when
  paused) via `getAllowedActions`, reusing `ALLOWED_TRANSITIONS`.

```bash
npm test --workspace @ott/platform-api -- round-rules
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/round-rules.integration.test.ts
```

## Hash reservation, upload throttling and preflight queue position (`P3-D03`)

`P3-D03` adds hash reservations, upload throttling backpressure, and preflight position tracking:

- **Endpoints & Headers**:
  - `POST /api/v1/submission-reservations` (Role: `TEAM_ACCOUNT`):
    Accepts JSON body `{ "archiveSha256": "sha256:<64 hex>" }`.
    Returns 201 (on creation) or 200 (idempotent re-reservation of identical hash) `{ data: { id, archiveSha256, roundId, reservedAt, graceEndsAt, status } }`.
    Reservation is rejected after the round's `submissionDeadlineAt`.
  - `GET /api/v1/submission-reservations/current` (Role: `TEAM_ACCOUNT`):
    Returns the team's latest reservation in the currently open round, or `{ data: null }` if none exists.
  - `POST /api/v1/submissions` (Role: `TEAM_ACCOUNT`):
    Optional header: `X-Reservation-Id: <uuid>`.
    Required when uploading during the round grace window (`submissionDeadlineAt < now <= graceEndsAt`).
    Uploads before `submissionOpensAt` return 409 `SUBMISSION_NOT_OPEN`.
    Uploads after `graceEndsAt` always return 403 `SUBMISSION_CLOSED`.
    Archive hash must match reservation hash; mismatch returns 409 `RESERVATION_HASH_MISMATCH` and cleans up storage.
    Retrying an upload of the same archive after completion returns 200 with the existing submission ID idempotently without duplicate storage or rows.
  - `GET /api/v1/submissions` (Role: `TEAM_ACCOUNT`):
    Each item in `PREFLIGHT` status gains `preflightPosition` (1-based rank among all `PREFLIGHT` submissions ordered by `(created_at, id)`). Non-`PREFLIGHT` items receive `null`.
    Response root includes `preflightQueueLength` (total submissions currently in `PREFLIGHT`).

- **Preflight Queue Position Note**:
  No preflight background job enqueuer exists yet in the platform (submissions sit in `PREFLIGHT` until evaluated). `preflightPosition` and `preflightQueueLength` are therefore derived deterministically from PostgreSQL by counting submissions with `status = 'PREFLIGHT'` ordered by `(created_at, id)`.

- **Concurrency Limiting**:
  In-process concurrency limiter (`upload-limiter.ts`) guards `POST /api/v1/submissions` before buffering the 256 MiB body:
  - Defaults: global max concurrent uploads = 8; per-team max concurrent uploads = 1; retry-after base = 5 seconds.
  - When limits are exceeded, returns HTTP 429 `{ error: { code: 'UPLOAD_BUSY', message: '...' } }` with a `Retry-After` header (integer seconds >= 1, computed as base + queue position offset) instead of hanging.
  - Slot acquired in `onRequest` hook and released on finish, error, or request abort.

- **Stable Error Codes**:
  - `SUBMISSION_NOT_OPEN` (409): Attempted reservation or upload when round is not `SUBMISSION_OPEN` or before `submissionOpensAt`.
  - `SUBMISSION_DEADLINE_PASSED` (403): Attempted new reservation after `submissionDeadlineAt`.
  - `RESERVATION_REQUIRED` (403): Upload during grace window without `X-Reservation-Id`.
  - `RESERVATION_INVALID` (403): `X-Reservation-Id` does not exist or does not belong to the authenticated team and current round.
  - `RESERVATION_HASH_MISMATCH` (409): Uploaded archive SHA-256 does not match the reserved hash.
  - `SUBMISSION_CLOSED` (403): Upload attempted after `graceEndsAt`.
  - `UPLOAD_BUSY` (429): Concurrency limit reached; `Retry-After` header indicates backoff seconds.
  - `INVALID_ARCHIVE_SHA256` (400): Malformed SHA-256 format in reservation request body.

- **Verification**:
  - Unit tests: `npm test --workspace @ott/platform-api -- submission-reservations`
  - Integration tests: `tests/submission-reservations.integration.test.ts` (gated on `DATABASE_URL`, `REDIS_URL`, and S3 environment variables).

## Bulk team provisioning (`P3-D04`)

`P3-D04` adds bulk team import via CSV and bulk credential reset for `BTC_ADMIN`:

- **Endpoints**:
  - `POST /api/v1/admin/teams/bulk-import`: accepts strict JSON `{ "csv": string }` (body limit 512 KiB). Validates CSV atomically, hashes credentials before the transaction, acquires an advisory lock, pre-checks uniqueness against DB, inserts teams and accounts, and streams a one-time CSV download.
  - `POST /api/v1/admin/teams/bulk-reset`: accepts strict JSON `{ "teamIds": string[] }` (1–500 UUIDs). Pre-hashes new passwords, updates accounts transactionally, revokes all active Redis sessions for those accounts, and streams a new credential file.
  - `GET /api/v1/admin/teams`: includes `representativeEmail` (string or null) for BTC operators.

- **CSV Format & Validation**:
  - Pure RFC 4180 parser with UTF-8 BOM stripping, CRLF/LF line endings, and quoted field handling.
  - Header: exactly `team_name,representative_email` (case-insensitive, trimmed).
  - Rows: 1–500 data rows. Each row must have exactly 2 fields.
  - `team_name`: trimmed, 1–100 chars, no control characters.
  - `representative_email`: trimmed, lowercased, ≤254 chars, valid email format.
  - Error codes: `CSV_HEADER_INVALID`, `CSV_EMPTY`, `CSV_TOO_MANY_ROWS`, `ROW_FIELD_COUNT`, `TEAM_NAME_INVALID`, `EMAIL_INVALID`, `DUPLICATE_TEAM_NAME`, `DUPLICATE_EMAIL` (with `relatedRow`), `TEAM_NAME_TAKEN`, `EMAIL_TAKEN`, `TEAM_NOT_FOUND`. All errors collected at once; cell values are never echoed in error objects.

- **One-time Credential File & Security**:
  - Password plaintext exists only in the response stream. DB persists only Argon2id hashes.
  - Audit events record only `TEAM_CREATED` per team and `TEAM_BULK_IMPORTED` / `TEAM_BULK_CREDENTIAL_RESET` with `target_type: 'TEAM_BATCH'` and `reason: 'count=<n>'`. Plaintext passwords never enter DB, logs, metrics, or audit rows.
  - Download once: no credential file is stored on the server. If the BTC operator loses the file ("mất file"), they must invoke bulk reset (or single reset) to issue fresh credentials.
  - CSV injection protection: output cells starting with `=`, `+`, `-`, `@`, tab or CR receive a leading `'`.
  - Representative email is personal data: stored via migration `0008_team_representative_email.sql` (case check constraint and partial unique index); BTC-only; never disclosed to team accounts, public leaderboards, or audit rows.

- **Verification**:
  - Unit/route tests: `npm test --workspace @ott/platform-api -- bulk-teams`
  - Integration tests: `tests/bulk-teams.integration.test.ts` (gated on `DATABASE_URL` and `REDIS_URL`).

## Admin TOTP, network allowlist and hosted startup guard (`P3-D06`)

`P3-D06` hardens control plane ingress with two-factor authentication (TOTP + recovery codes), an effective client IP spoofing defense with a server-side CIDR allowlist for admin endpoints, write rate limiting, security headers, and an AC-23 fail-closed startup guard.

### Environment variables

| Variable | Type / Format | Default | Description |
|---|---|---|---|
| `OTT_DEPLOYMENT_MODE` | `'dev' \| 'test' \| 'hosted' \| 'production'` | **Required** | Deployment environment mode. Missing/unknown throws. |
| `OTT_ADMIN_TOTP_REQUIRED` | `'true' \| 'false'` | `false` | Whether BTC admin authentication requires TOTP. Must be `true` in `hosted`/`production`. |
| `OTT_ADMIN_ALLOWLIST` | Comma-separated CIDRs | `[]` (allow all in dev/test) | Server-side CIDR allowlist for `/api/v1/admin/*` and `/api/v1/auth/mfa/*`. Must be non-empty in `hosted`/`production`. |
| `OTT_TRUSTED_PROXIES` | Comma-separated CIDRs or `none` | `[]` (dev/test) | Explicit reverse proxies trusted to set `X-Forwarded-For`. Must be explicitly set in `hosted`/`production` (cannot contain `0.0.0.0/0` or `::/0`). |
| `OTT_TOTP_ENCRYPTION_KEY` | Base64-encoded 32 bytes | `null` | AES-256-GCM key for encrypting TOTP secrets at rest in `admin_mfa`. Required whenever TOTP is enabled. |
| `OTT_WRITE_RATE_LIMIT_IP` | Integer > 0 | `600` | Max write requests (POST/PUT/PATCH/DELETE) per minute per effective client IP. |
| `OTT_WRITE_RATE_LIMIT_ACCOUNT` | Integer > 0 | `300` | Max write requests per minute per authenticated account. |
| `OTT_BOOTSTRAP_BTC_TOTP_SECRET` | Base32 string | `undefined` | Optional known TOTP secret for initial bootstrap of BTC admin account. |

### AC-23 Startup Guard

`assertSecurityConfig` validates configuration before routes are mounted:
- **`hosted` and `production`**: Fails startup immediately with a single error listing every violation if:
  1. `OTT_ADMIN_TOTP_REQUIRED` is not `true`;
  2. `OTT_ADMIN_ALLOWLIST` is empty;
  3. `OTT_TRUSTED_PROXIES` is unset or ambiguous (`0.0.0.0/0` or `::/0`);
  4. `OTT_TOTP_ENCRYPTION_KEY` is missing or not 32 bytes.
- **`dev` and `test`**: Permissive mode for automated testing and local development (allows password-only BTC login, empty allowlist, no proxies); malformed values are still rejected.

### Effective client IP & Spoofing Defense

Fastify `trustProxy` is not enabled. Client IP is resolved in `onRequest` via `effectiveClientIp`:
- If the socket remote address is not in `trustedProxies`, `X-Forwarded-For` is completely ignored.
- If the socket is a trusted proxy, `X-Forwarded-For` is parsed right-to-left to identify the first untrusted upstream IP.
- Client IP is used for network allowlist enforcement and login rate limiting.

### Endpoints and Error Codes

| Endpoint | Method | Role / Precondition | Description |
|---|---|---|---|
| `/api/v1/auth/login` | POST | Public | Authenticates credentials. If BTC admin and `totpRequired=true`, responds `{ data: { mfaRequired: true } }` and sets `ott_mfa` challenge cookie. |
| `/api/v1/auth/login/mfa` | POST | Public (with challenge) | Verifies `{ code }` (6 digits) or `{ recoveryCode }` (base32), checks replay, marks recovery code used, sets `ott_session` cookie with `mfa: true`. |
| `/api/v1/auth/mfa/enroll` | POST | `BTC_ADMIN` (allowlist applies) | Generates new random Base32 secret + `otpauth://` URI (returned once, `Cache-Control: no-store`). |
| `/api/v1/auth/mfa/confirm` | POST | `BTC_ADMIN` (allowlist applies) | Confirms pending enrollment with `{ code }`, encrypts and stores in `admin_mfa`, generates 10 single-use recovery codes. |
| `/api/v1/auth/mfa/recovery-codes` | POST | `BTC_ADMIN` (allowlist applies) | Invalidates unused recovery codes and generates 10 new recovery codes. |

Stable error codes:
- `INVALID_CREDENTIALS` (401): Returned uniformly for unknown username, wrong password, wrong TOTP code, replay, expired challenge, un-enrolled account, or missing challenge. Never reveals account or enrollment existence.
- `ADMIN_NETWORK_FORBIDDEN` (403): Returned when an admin route is accessed from an IP not in `adminAllowlist`.
- `LOGIN_RATE_LIMITED` (429): Returned when failed login attempts exceed the threshold per username + IP.
- `RATE_LIMITED` (429): Returned with `Retry-After: 60` header when general write rate limits are exceeded.
- `FORBIDDEN` (403): Insufficient role or non-MFA session attempting MFA administration.

### Operator steps

1. **Generate encryption key**:
   ```bash
   openssl rand -base64 32
   ```
2. **Bootstrap with TOTP secret**:
   ```bash
   export OTT_DEPLOYMENT_MODE=hosted
   export OTT_ADMIN_TOTP_REQUIRED=true
   export OTT_ADMIN_ALLOWLIST="10.0.0.0/8,192.168.1.0/24"
   export OTT_TRUSTED_PROXIES="10.0.0.1"
   export OTT_TOTP_ENCRYPTION_KEY="<base64-32-bytes>"
   export OTT_BOOTSTRAP_BTC_USERNAME="admin"
   export OTT_BOOTSTRAP_BTC_PASSWORD="<strong-password>"
   export OTT_BOOTSTRAP_BTC_TOTP_SECRET="<base32-secret>"
   ```
3. **Generate recovery codes post-login**:
   Bootstrap configures the initial TOTP secret. Upon first login with TOTP, the BTC operator calls `POST /api/v1/auth/mfa/recovery-codes` to generate and display the 10 emergency recovery codes.

## Privileged operations and public queue overrides (`P3-D07`)

Migration `0013_operations_cases.sql` (registered in `src/db/schema.ts`) adds the history-preserving
tables (its cases tables were dropped again by `0018_drop_operations_cases.sql`, see below); code lives in `src/modules/operations/` (`service.ts`, `routes.ts`, `types.ts` validators,
`export.ts` sanitizer, `results-hash.ts`). Operations never edit `match_results`, `rating_ledger` or any
historical row.

### Rules shared by every privileged action

- `BTC_ADMIN` only (plus the existing admin network/MFA gates for `/api/v1/admin/*`).
- Body `reason` is required, 1-500 characters (`400 INVALID_REASON`).
- `X-Correlation-Id` (UUID) is echoed in the response header and body; it is generated when absent and
  a malformed value is `400 INVALID_CORRELATION_ID`.
- Optional `Idempotency-Key` (1-200 printable chars) on suspend, unsuspend, revoke, cancel and rerun:
  same key and same payload returns the stored outcome (`data.replayed: true`, no second audit row);
  the same key with a different payload is `409 IDEMPOTENCY_KEY_REUSED`.
- One transaction writes the state change and one `audit_events` row with
  `details = { before, after, requestHash }` (ids, statuses and counts only; secret-looking keys are
  stripped before insert). `audit_events` and `queue_overrides` reject
  `UPDATE`/`DELETE` through triggers (`TRUNCATE` stays available for test fixtures).

### Endpoints (`/api/v1/admin/operations`)

| Method and path | Effect | Errors |
| --- | --- | --- |
| `POST /teams/:teamId/suspend`, `/unsuspend` | `accounts.status` ACTIVE↔DISABLED; suspend also revokes DB and Redis sessions | `404 TEAM_NOT_FOUND`, `409 TRANSITION_INVALID` |
| `POST /submissions/:id/revoke` | `VALID`/`ACTIVE` → `REVOKED` (lifecycle in requirements §8.3); played matches untouched | `404 SUBMISSION_NOT_FOUND`, `409 TRANSITION_INVALID` |
| `POST /matches/:id/cancel` | `SCHEDULED`/`FAILED` → `CANCELLED`; body `publicReason` (1-200); inserts a `queue_overrides` row | `404 MATCH_NOT_FOUND`, `409 CANCEL_NOT_ALLOWED` |
| `POST /matches/:id/rerun` | see below; body `reason`, `publicReason`, `verifiedInfraFailure: true` | `400 RERUN_CONFIRMATION_REQUIRED`, `409 RERUN_*` |
| `GET /audit` | filters `targetType`, `targetId`, `actorAccountId`, `action`, `from`, `to`, `page`, `pageSize` (≤100) | `400 INVALID_QUERY` |
| `GET /audit/export` | NDJSON, sanitized | |

### Removed in P3-D27 (2026-10-18)

The anomaly / duplicate / appeal "cases" backend was removed by the project owner's decision: cases were
only a log that nothing acted on, and appeals are handled outside the platform (email / GitHub issues).
Migration `0018_drop_operations_cases.sql` drops `operations_case_events`, `operations_cases`,
`enforce_operations_case_transition()` and `queue_overrides.case_id`; the `/cases` routes no longer exist
(`404`), and `caseId` is no longer accepted by cancel/rerun (`400 INVALID_REQUEST`). Retained: privileged
actions, `audit_events` (existing `CASE_*` rows stay readable through `GET /audit` and immutable), queue
overrides, the shared `reject_append_only_mutation()` function and the round results hash.

### Rerun rules

A rerun only recovers infrastructure failures. All of these must hold, else `409` with the listed code
(first failing rule wins):

1. `matches.status = 'FAILED'` (`RERUN_MATCH_NOT_FAILED`) and no `match_results` row (`RERUN_RESULT_EXISTS`).
2. The latest `match_attempts` row is `FAILED_TERMINAL` with `failure_reason` in `INFRA_FAILURE_REASONS`
   = `MATCH_LEASE_EXPIRED`, `MATCH_EXECUTION_FAILED`, `SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH`,
   `MATCH_EVENT_LOG_INTEGRITY_FAILED`, `SANDBOX_NOT_RUNNING` (`RERUN_NOT_INFRA_FAILURE`). Bot faults are
   recorded as `FORFEIT` results and never reach `FAILED`. Any other code is refused.
3. The request carries `verifiedInfraFailure: true` and a reason; both appear in the audit `details`.
4. The schedule round is still `SCHEDULED`, the series has no `rating_ledger` row and is not `FINALIZED`
   (`RERUN_ROUND_SETTLED`). A series cancelled with `INFRASTRUCTURE_FAILURE` is reopened
   (`SCHEDULED`, cancellation reason and `finalized_at` cleared); a series cancelled for
   `MATCH_CANCELLED` is never revived (`RERUN_SERIES_CANCELLED_BY_OPERATOR`).
5. No undispatched `MATCH_RERUN` outbox row exists for the match (`RERUN_ALREADY_PENDING`).

The transaction sets the match back to `SCHEDULED`, inserts a `match_outbox` row
(`event_type='MATCH_RERUN'`, `generation = previous max + 1`, payload copied from the original
`MATCH_SCHEDULED` row), a public `queue_overrides` row and the audit row. The failed attempt row stays as
history; the unchanged worker creates the next attempt number when it claims the job. Migration 0013 drops
the old `UNIQUE (match_id, event_type)` and adds `UNIQUE (match_id, event_type, generation)`.
`dispatchScheduledMatches` publishes both event types and passes `{ generation }`; `MatchQueue.enqueue`
uses job id `match-<id>-r<generation>` for generations above 0 (generation 0 keeps `match-<id>`). When
`createAuthApp` is given `matchEnqueuer`, the API tries to publish right after commit; the outbox stays the
source of truth, so a Redis outage never fails the rerun.

Known limitation: once every series of a round has settled the round is `FINALIZED` and ratings are
applied; a rerun is then refused. BTC must rerun before the last series of the round settles (pause the
queue and act promptly). Reopening a rated round would need a ratings rebuild and is out of scope.

### Exports and public overrides

The audit export passes through `export.ts`: a field allowlist, and every key
matching `seed|password|secret|credential|stderr|object_?key|token|hash_of_password` (case-insensitive,
any nesting depth) is dropped.

`GET /api/v1/public/queue-overrides` is unauthenticated and read-only. It returns only
`{ id, action, matchOpaqueId, publicReason, createdAt }` (`matchOpaqueId` is the first 16 hex characters of
`sha256("queue-override-match:" + matchId)`); no team names or account ids. P3-L05 consumes it.

### Round results hash

At `publish` the round's `results_hash` is stored (column added in 0013, settable only once and only with
`status = 'PUBLISHED'`), written to the `ROUND_PUBLISHED` audit `details.resultsHash` and returned as
`resultsHash` by `GET /api/v1/admin/rounds/:roundId` and the publish response. It is
`sha256(canonicalJson(document))` with `canonicalJson` from `rounds/types.ts` (sorted keys, no whitespace) and

```json
{ "version": 1,
  "matches": [{ "matchId": "…", "finalStateHash": "…", "eventLogSha256": "…|null" }],
  "ratings": [{ "seriesId": "…", "teamId": "…", "ratingBefore": 0, "ratingAfter": 0, "delta": 0 }] }
```

`matches` are the schedule round's `FINALIZED` matches with a result ordered by match id; `ratings` are its
`rating_ledger` rows ordered by `(series_id, team_id)`. A second publish is `409 ROUND_TRANSITION_INVALID`
and cannot change the stored hash.

### Verification

`npm test --workspace @ott/platform-api -- operations` (unit and route tests need no services;
`operations.integration.test.ts` needs `DATABASE_URL` and `REDIS_URL` and skips otherwise).

## Qualification gate, adaptive K and minimum-series eligibility (`P3-L03`)

Migration `0014_qualification_gate.sql` adds `rounds.rating_policy_version` and `submission_gate_results`.

### Rating policy (pinned per round)

| `rating_policy_version` | K |
| --- | --- |
| `elo-k32-v1` (column default, every pre-0014 round) | 32 always — Phase 2 ledgers rebuild unchanged |
| `elo-adaptive-k-v1` (set by `scheduleRound` on new rounds) | 64 while the team has fewer than 5 earlier rated series, else 32 |

- "Earlier rated series" = `FINALIZED` series of the same stage in rounds that precede the round in the order
  `rebuildRatingLedger` walks (`finalized_at, id`). Cancelled / infra-failed series earn no ledger row and never count.
  The count is taken from `series`, not `rating_ledger`, so it does not depend on which rounds were already applied;
  incremental apply and rebuild therefore produce identical rows.
- Each team's delta uses its own K. With equal K the legacy zero-sum rounding is kept; with different K the two deltas
  are not exact negatives, so total rating is **not conserved** under `elo-adaptive-k-v1`. The ledger stores each team's own delta and
  `RATING_LEDGER_MISMATCH` still compares every stored row with the recomputed one.
- `rating_policy_version` is in the round snapshot trigger's protected columns (immutable after insert).

### Finals eligibility and leaderboard labels

`scheduling/eligibility.ts`: `finalsEligibility({ ratedSeries, minimumSeries })` (default `DEFAULT_MINIMUM_FINALS_SERIES = 5`,
integer >= 1). `GET /api/v1/leaderboard` rows gain `ratedSeries`, `finalsEligible` and `ratingStatus`
(`RANKED` | `UNRANKED_MIN_SERIES`, shown in the web as "Chưa xếp hạng"); ordering and existing fields are unchanged.
Optional query `minimumSeries` (1-50, else `400 INVALID_QUERY`). BTC lowering the threshold for stages with fewer than six
rounds is a caller-supplied value; storing it per stage is supplied by `P3-D08`.

### Capture-first gate

`submission_gate_results` is append-only (trigger `reject_append_only_mutation`), unique per
`(submission_id, gate_bot_id, gate_bot_digest)`, and `outcome = 'PASS'` exactly when `points >= 1`.
`recordGateResult` reads the two finalized `match_results`, requires that both games are the submission's, were played against a
submission whose `oci_manifest_digest` equals the pinned `gateBotDigest`, and on opposite sides. It computes win 1 / draw 0.5 / loss 0
itself; client points are rejected. A game that is not finalized (running, `FAILED`, `CANCELLED`) gives `409 GATE_PENDING`, never a FAIL.

| Endpoint (BTC_ADMIN only) | Result |
| --- | --- |
| `POST /api/v1/admin/qualification-gate/results` body `{ reason, submissionId, gateBotDigest, game1MatchId, game2MatchId, gateBotId? }` | `201` new / `200` replay; `409 GATE_RESULT_CONFLICT` for other matches on the same key; `422 GATE_SIDES_NOT_SWAPPED` / `GATE_MATCH_FOREIGN`; `404`; one `qualification_gate.record` audit row, `X-Correlation-Id` echoed |
| `GET /api/v1/admin/qualification-gate/submissions/:submissionId` | `{ rankable, results[] }` |

`OTT_QUALIFICATION_GATE_ENFORCED=true` makes `scheduleRound` skip teams whose ACTIVE submission has no PASS row
(default off, existing behaviour). Follow-ups, not in this task: queueing/running the two gate matches in the preflight queue
(needs worker/job work) and per-stage gate-bot configuration in the round rule set (D01 schema is frozen).

### Verification

`npm test --workspace @ott/platform-api -- ratings` and `-- qualification-gate` (unit/route tests need no services;
`qualification-gate.integration.test.ts` needs `DATABASE_URL`).

## Finals ResultBundle artifact schemas (`P3-D28`, proposed)

Pure contract + validators + deterministic builder for the finals artifacts inside a ResultBundle (`bracket.json`,
`series/*`, `matches/*`, `replays/*`). Contract: `docs/contracts/finals-result-bundle-v1.md` (section "Artifact schemas v1")
and `docs/contracts/finals-result-bundle-artifacts-v1.schema.json`. Module:
`src/platform/api/src/modules/result-bundles/artifacts.ts` (`validateBundleArtifacts` returns the read model after
recomputing all outcomes with the L06 domain functions; `buildFinalsBundleArtifacts` feeds `exporter.ts`). Not wired into
the importer or any route yet (D29). Tests: `tests/finals-bundle-artifacts.test.ts` (no database).
