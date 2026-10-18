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

## Running the worker (P3-D32)

### Environment Configuration

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | - | PostgreSQL connection URL (`postgres://...` or `postgresql://...`) |
| `REDIS_URL` | Yes | - | Redis connection URL (`redis://...` or `rediss://...`) |
| `S3_ENDPOINT` | Yes | - | S3/SeaweedFS API endpoint URL (`http://...` or `https://...`) |
| `S3_BUCKET` | Yes | - | S3 storage bucket name |
| `S3_ACCESS_KEY_ID` | Yes | - | S3 credentials access key ID |
| `S3_SECRET_ACCESS_KEY` | Yes | - | S3 credentials secret access key |
| `S3_REGION` | No | `us-east-1` | S3 region |
| `OTT_MATCH_QUEUE` | No | `ott.match.v1` | BullMQ match queue name (must match API) |
| `OTT_DEAD_LETTER_QUEUE` | No | `ott.match.dead-letter.v1` | Dead-letter queue name |
| `OTT_WORKER_ID` | No | auto-generated | Persistent worker identifier (`worker-<uuid>`) |
| `OTT_WORKER_MAX_CONCURRENCY` | No | `4` | Maximum concurrent matches |
| `OTT_WORKER_MIN_CONCURRENCY` | No | `1` | Minimum concurrent matches (must be <= max) |
| `OTT_WORKER_HEARTBEAT_MS` | No | `5000` | Heartbeat write interval in milliseconds |
| `OTT_WORKER_HEARTBEAT_TTL_SECONDS` | No | `15` | Heartbeat TTL in Redis (must be > interval) |
| `OTT_WORKER_METRICS_HOST` | No | `127.0.0.1` | Host address for metrics server (internal only) |
| `OTT_WORKER_METRICS_PORT` | No | `9464` | Port for metrics server (`0` for ephemeral, `off` to disable) |
| `OTT_DOCKER_SOCKET` | No | `/var/run/docker.sock` | Path to Docker Engine UNIX domain socket |
| `OTT_WORKER_REQUIRE_DOCKER` | No | `true` | Enforce Docker availability at startup |
| `OTT_SHUTDOWN_TIMEOUT_MS` | No | `30000` | Drain wait timeout for in-flight matches |

### Job Routing & Test-Run Dispatch

The worker receives jobs from the BullMQ match queue formatted as strict `MatchJobV1` payloads. To distinguish official tournament matches from test runs without modifying cross-package schemas or queue contracts:
- The worker executes an indexed primary-key query `SELECT 1 FROM test_runs WHERE id = $1` using `job.matchId`.
- **Rationale**: Primary keys in both `matches` and `test_runs` are cryptographically random UUIDs generated independently, ensuring that a test-run ID can never collide with a match ID. The primary key lookup incurs minimal overhead (one indexed read per job), prevents test runs from ever being silently processed as official tournament matches, and requires zero cross-package schema changes.
- If a `test_runs` row is found, the job is dispatched to `runTestJob({ testRunId: job.matchId, database, storage, metrics })`.
- If no row exists, the job is dispatched to `runMatchJob({ job, database, storage, attempt, metrics })`.
- If the database query itself fails (e.g. database down), the error propagates to trigger standard BullMQ worker retries and never falls back to match execution.

### Endpoints (Internal Only)

The worker process exposes an HTTP service for metrics and health checking (bound to loopback `127.0.0.1` by default):

- `GET /metrics`: Prometheus formatted scrape output (`text/plain; version=0.0.4`), sanitized through `assertMetricsSanitized`.
- `GET /health/live`: Returns 200 `{"status":"ok"}`.
- `GET /health/ready`: When all dependencies pass within 2 s:
  - When `OTT_WORKER_REQUIRE_DOCKER=true` (default): Returns 200 `{"status":"ready"}`.
  - When `OTT_WORKER_REQUIRE_DOCKER=false`: Returns 200 `{"status":"ready","docker":"up"|"down"}`.
  - When dependencies fail or worker is not ready: Returns 503 `{"status":"not_ready"}` with no internal details leaked.

### Shutdown Behaviour

On receiving `SIGTERM` or `SIGINT`:
1. Readiness switches to false immediately (`ready=false`).
2. The worker pool pauses (`pool.pause('shutdown')`), refusing new work.
3. The host waits for active in-flight matches to complete up to `OTT_SHUTDOWN_TIMEOUT_MS`.
4. The worker pool closes (`pool.close()`), removing the Redis heartbeat key and active-set entry.
5. The metrics HTTP server is closed.
6. S3 client and database pools are closed cleanly.
Repeated calls to `stop()` are idempotent and share the same Promise.

### Local Run

To start the worker runtime locally:

```bash
docker compose -f infra/local/compose.yaml up -d
cp .env.example .env
npm run start:worker
```

### Security Notes

- **Docker Socket Isolation**: The Docker socket (`/var/run/docker.sock`) must only be accessible to the trusted worker process. It is never mounted into untrusted bot containers.
- **Bot Sandboxing**: Bot containers run under `OTT_SANDBOX_V1` with `network=none`, read-only root filesystems, dropped capabilities, and strict CPU/memory limits.
- **Internal Metrics**: The metrics and health HTTP port is strictly internal and must never be exposed or mapped to public/WAN ingress.
