# `@ott/platform-worker`

Execution-plane BullMQ consumer for versioned `MatchJobV1` messages. It is a
separate process from the API. It imports the public job contract and exposes a
Docker-backed `SandboxOciBotPort`; P2-T11 composes the port with MatchRunner and
result finalization. Only this trusted worker may access the Docker Engine
socket. The socket is never mounted into a bot container.

`runMatchJob` is the processor passed to `createMatchWorker`. It verifies the
database's pinned submissions, downloads and checks archive SHA-256, maps the
single supported job profile (`P2_BASELINE_V1`) to the sandbox implementation
policy (`OTT_SANDBOX_V1`), runs `@ott/match-runner`, verifies the replay, then
commits result, events and a unique `MATCH_FINALIZED` outbox row. Attempts use a
15-minute database lease; repeated deliveries after finalization return the
stored official result without executing bots again. Bot faults become official
forfeit results; infrastructure faults are retryable and record stable codes.

The API enqueues `ott.match.v1` jobs with `jobId=match-<match UUID>`, three
attempts, exponential backoff starting at one second, and terminal-job
retention. The worker validates the strict versioned payload before invoking
its handler. Final failures are copied idempotently to
`ott.match.dead-letter.v1`; structured log fields contain match ID, attempt and
stable error code only, never bot stdout/stderr or the full job payload.
Malformed messages are sent to that queue immediately with only a SHA-256
message fingerprint; they are not retried and the raw payload is not copied.

`close()` stops accepting new work and waits for active jobs before closing
Redis connections. The host should call it from SIGTERM/SIGINT handling.

From the repository root:

```bash
npm run typecheck --workspace @ott/platform-worker
REDIS_URL="$YOUR_LOCAL_REDIS_URL" npm test --workspace @ott/platform-worker -- --run tests/match-job.integration.test.ts
npm --workspace @ott/sandbox-corpus run build:corpus
npm test --workspace @ott/platform-worker -- --run tests/sandbox.integration.test.ts
```

The PostgreSQL-backed finalization integration test requires an empty,
disposable database because it applies migrations. It does not reset the schema
or touch unrelated rows:

```bash
DATABASE_URL="$YOUR_DISPOSABLE_POSTGRES_URL" \
  npm test --workspace @ott/platform-worker -- --run tests/finalization.integration.test.ts
```

The sandbox integration command requires a local Docker Engine and the generated
OCI fixture archives. It validates the pinned archive/manifest/config identity,
imports through Docker Engine API (never Docker CLI or a user command), and
enforces `OTT_SANDBOX_V1`: non-root, `network=none`, read-only root, all Linux
capabilities dropped, no mounts/devices, 1 vCPU, 256 MiB RAM, 64 PIDs, 64 MiB
`/tmp`, 4 MiB stdout, 1 MiB stderr, 64 KiB per protocol message and a 3-second
turn timeout. The quota is an implementation baseline only; `P2-T15` is the
benchmark and public-registration gate. Its single-host evidence is recorded at
`src/bots/sandbox-corpus/results/2026-10-13-local-docker.json`. Recreate it with:

```bash
npm --workspace @ott/sandbox-corpus run build:corpus
OTT_SANDBOX_BENCHMARK_REPORT="$PWD/src/bots/sandbox-corpus/results/2026-10-13-local-docker.json" \
  npm test --workspace @ott/platform-worker -- --run tests/sandbox.integration.test.ts
```

This run does not qualify a fair public profile. Keep team registration closed
until repeated representative-host measurements are reviewed and the tournament
owner approves D-08.

## Phase 3 timing integration

After migration `0018_match_protocol_v2`, the worker reads each match's immutable `protocol_v2`/`rule_set_id`
snapshot. Existing rows remain v1. V2 snapshots are validated with the machine schema before acquiring a lease;
invalid snapshots raise `MATCH_PROTOCOL_SNAPSHOT_INVALID`. The runner receives private per-side seeds,
pinned time control and a monotonic clock. Finalization verifies and stores both event-log versions.

`SandboxOciBotPort` preserves pinned v2 INIT, rejects downgrade replies and enforces the runner's effective
deadline. V2 startup timeout also cleans up a container that starts late. Archive loading is outside the
spawn/INIT startup window; OS isolation and resource quotas are unchanged.

Checks: `npm test --workspace @ott/platform-worker -- sandbox-v2` (Docker transport double), and with an isolated
`DATABASE_URL`, `npm test --workspace @ott/platform-worker -- timing-worker` (real PostgreSQL + two Node bot
processes, timing mutation rejection, exactly-once finalization). The latter does not replace the real Docker
sandbox corpus qualification required for the hosted checkpoint.
