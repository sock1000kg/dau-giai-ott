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
