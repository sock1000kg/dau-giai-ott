# Runbook — Phase 2 local application and sandbox

## Prerequisites

- Follow [local services](local-services.md) for PostgreSQL, Redis and SeaweedFS.
- Node.js 22, npm workspaces and a local Docker Engine accessible to the worker.
- Do not expose the Docker socket to bot containers or browser-facing services.

## Sandbox corpus and quota qualification

Build trusted local canaries and run the sandbox integration test:

```bash
npm --workspace @ott/sandbox-corpus run build:corpus
npm --workspace @ott/sandbox-corpus test
npm test --workspace @ott/platform-worker -- --run tests/sandbox.integration.test.ts
```

To record startup, first-action and Docker quota samples, set
`OTT_SANDBOX_BENCHMARK_REPORT` to the version-controlled report path before the
worker test. The checked-in single-host result and gate decision are documented
in [the OCI sandbox SAD](../architecture/sad-oci-bot-submissions.md).

`OTT_SANDBOX_V1` is an internal implementation baseline, not a published team
quota. Do not open team registration based on a single developer-machine run;
registration remains closed until repeated measurements on representative
hosts establish fairness/isolation and the tournament owner approves D-08.

## Isolated qualification harness

Run the deterministic qualification fixture harness from the repository root:

```bash
npm run test:e2e:qualification -- --runInBand --testNamePattern harness
```

The command requires Node.js 22, Docker Engine/Compose, installed npm
dependencies, the checked-in sandbox profile and all corpus archives with
matching SHA-256 digests. It preflights those inputs before creating resources,
then starts PostgreSQL, Redis and SeaweedFS with an unpredictable Compose
project name, loopback-only ephemeral host ports, per-run credentials, and
isolated volumes. It applies migrations and seeds a BTC account, two team
accounts and exactly two active Python canary submissions. The harness tests
fail-fast validation, safe Compose scoping, loopback port parsing and fixture
seed state.

An exit trap tears down only that Compose project and its volumes, checks that
its containers/volumes are gone, and removes its temporary credential file.
Never replace the generated Compose project name with a shared/local project or
point these tests at a shared database. `--runInBand` is accepted as a
compatibility alias and maps to Vitest's no-file-parallelism option.
This environment-bound E2E file is excluded from the default root `npm test`
and is selected by the dedicated qualification config used by the command above.

## Full qualification handoff

Run the complete local gate (harness plus end-to-end flow) from the repository
root:

```bash
npm run test:e2e:qualification
npm run typecheck
npm test
npm run build
```

The full-flow test creates and logs into BTC-provisioned team accounts, uploads
the checked-in Python OCI canaries through the authenticated API, runs the
worker's `preflightSubmission` against the real Docker sandbox, schedules a
BO2 round, publishes its outbox jobs to a run-named BullMQ queue, and runs the
actual worker/finalization path. It then verifies series settlement, Elo,
team/BTC results, leaderboard, BTC replay stage/publish, tamper rejection, and
the public spectator client's checksum/schema/timeline projection. Stable
schedule, preflight, job, settlement, rating and publication retries are
asserted not to duplicate their records.

For isolation, the E2E creates a random PostgreSQL schema and queue name, uses
only the Compose services from this script, and removes its schema, exact S3
objects, Redis sessions, queues, sandbox containers and temporary local stack.
The worker preflight and scheduling are invoked through their service APIs by
the local harness; they are not separate HTTP endpoints. The public submission
route intentionally stops at `PREFLIGHT`; run this gate only with disposable
local services and never point it at a shared/production database.

## Match result finalization

`P2-T11` requires a disposable PostgreSQL database for its integration test; the
test applies migrations but does not drop the schema. Do not aim it at a shared
or production database.

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-worker -- --run tests/finalization.integration.test.ts
```

The worker verifies the event log before storing it. Result, normalized events,
match `FINALIZED` status and one `MATCH_FINALIZED` outbox event commit in the
same transaction. Object storage receives a content-addressed event-log object
before that transaction; an unreferenced object after a DB failure is harmless
and can be garbage-collected later. Unique match/result and outbox keys are the
deduplication boundary for queue redelivery.

## Qualification round scheduling

`P2-T12` requires a disposable PostgreSQL database with migrations applied; the
scheduling integration fixture uses unique teams/stage and removes only its
own rows. It does not reset or drop the schema.

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-api -- --run tests/scheduling.logic.test.ts tests/scheduling.integration.test.ts
```

BTC scheduling calls use a stable stage/idempotency key; the API generates and
persists the private round seed. Retry with the same key to retrieve the frozen
schedule. The API
transaction writes two swapped-side matches per pairing and queue outbox rows;
dispatch can be retried safely if Redis is unavailable. A series settles only
after both games are terminal. Infrastructure failure/cancellation cancels the
series with no score; a finalized bot forfeit remains an official game result.
The next round remains blocked until P2-T13 writes both Elo ledger entries for
each finalized series in the previous round; the API also rejects overlapping
open rounds in the same stage.
