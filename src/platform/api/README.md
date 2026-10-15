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
