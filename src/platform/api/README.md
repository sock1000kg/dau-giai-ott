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

Run the scheduler integration test only against a disposable PostgreSQL DB
with migrations applied; it creates and removes only its own unique fixture:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/scheduling.logic.test.ts tests/scheduling.integration.test.ts
```
