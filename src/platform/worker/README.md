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

## Running the coordinator (P2-T32)

The coordinator is a trusted background lifecycle engine that drives tournament execution end-to-end without manual intervention during round play.

### Automated Lifecycle Loops

| Loop | Default Interval | Description |
|---|---|---|
| `preflight` | 2000 ms | Discovers `PREFLIGHT` submissions, verifies them in the Docker sandbox, and activates them. Infrastructure errors leave submissions in `PREFLIGHT` for retry; bot faults mark submissions `INVALID`. |
| `dispatch` | 1000 ms | Reads unassigned `match_outbox` records and enqueues `MATCH_SCHEDULED` / `MATCH_RERUN` jobs to BullMQ (`ott.match.v1`). |
| `settle` | 5000 ms | Identifies completed series with terminal matches, invokes `settleSeries`, and triggers Elo rating calculations when all series finalize. |
| `snapshot` | 30000 ms | Collects and publishes `latest.json` and immutable `snapshot-<sha>.json` artifacts to `OTT_SNAPSHOT_DIR` for the public web UI. |
| `retention` | 3600000 ms | Periodic maintenance dry-run via `runRetentionPrune` when `OTT_COORD_RETENTION=dry-run` (`off` by default). |

### Single Active Instance & Advisory Lock

The coordinator MUST run as a single active instance to avoid conflicting lifecycle mutations:
- Active leadership is acquired via a dedicated PostgreSQL connection holding `pg_try_advisory_lock(hashtext('ott:coordinator'))`.
- Standby instances retry acquisition every 5 seconds, keep all loops paused, and report `{"status":"ready","role":"standby"}` on `/health/ready`.
- If the database connection drops, the active coordinator transitions immediately to `standby` and pauses loops until reconnection and re-acquisition.
- All coordinator loops are additionally idempotent so that any transient overlap creates no duplicate effects.

### Snapshot Directory & Pruning

Snapshots are written to `OTT_SNAPSHOT_DIR` (default: `src/platform/web/public/snapshots`), which is served statically by the dev web server. After each publish, the directory is pruned:
- Keeps the `OTT_SNAPSHOT_KEEP` newest `snapshot-*.json` files (by modification time).
- Guarantees that the file currently referenced by `latest.json` is **always preserved**, regardless of age.
- Never deletes unrelated files or follows symlinks.

### Editorial File

The coordinator re-reads the editorial JSON file on every snapshot publish (if `OTT_EDITORIAL_FILE` is set), allowing BTC to update announcements, FAQ, and status without restarting the process:

```json
{
  "announcements": [
    { "title": "Khai mạc vòng loại", "body": "Các trận đấu vòng loại bảng A chính thức bắt đầu." }
  ],
  "faq": [
    { "title": "Cách thức tính điểm?", "body": "Thắng 2 điểm, hòa 1 điểm, thua 0 điểm." }
  ],
  "status": {
    "message": "Hệ thống hoạt động bình thường",
    "incidentEta": null
  },
  "changelog": "Cập nhật luật thi đấu và thời gian tính nước đi.",
  "minimumSeries": 5
}
```

If `OTT_EDITORIAL_FILE` is omitted, the coordinator uses built-in default Vietnamese editorial metadata.

### Manual Steps Retained by BTC

In accordance with user design decisions, macro round phase transitions remain manual:
- BTC explicitly commands opening, closing, and starting rounds.
- BTC triggers reconciliation (`RUNNING → SETTLING → RATED`).
- The coordinator automates per-round mechanics: submission preflighting, outbox job dispatching, series outcome settlement, and public leaderboard snapshot generation.

### Known Gaps & Constraints

- **Layer Recording**: Image layer deduplication is not yet recorded by the submission upload path; real pruning (`OTT_COORD_RETENTION=on`) is deliberately disabled.
- **Docker Mount**: The coordinator is trusted worker-side code and is the only other process permitted to mount `/var/run/docker.sock` (for preflight smoke tests).

### Integration Testing & Fixture Verification

- **Local corpus build required**: Before running integration tests (`coordinator.integration.test.ts`), build the local bot corpus (`npm --workspace @ott/sandbox-corpus run build:corpus`) so that `first-legal.oci.tar` and `capture-first.oci.tar` are generated in `src/bots/sandbox-corpus/artifacts/oci-fixtures/`.
- **Dynamic fixture verification**: Committed manifest digests are NOT used for fixture verification because Docker builds differ across architectures and machines. The test dynamically computes archive digests and validates OCI archives via `validateOciSubmission` from `@ott/job-contract`.

### Docker Compatibility

The worker and coordinator communicate with the Docker Engine daemon via the UNIX domain socket (default `/var/run/docker.sock`). `DockerOciRuntime` dynamically negotiates the Engine API version prefix per runtime instance by querying unversioned `GET /version` on first contact. The negotiated version is computed as `max(1.41, MinAPIVersion)` capped at the server's `ApiVersion`. On older engines supporting API 1.41, requests use `/v1.41`; on modern engines such as Docker Engine 29.0+ (`MinAPIVersion 1.44`, `ApiVersion 1.52`), requests automatically use `/v1.44`, avoiding `400 Bad Request` API deprecation errors. The negotiated prefix can be explicitly overridden via the `apiVersion` constructor option or the `OTT_DOCKER_API_VERSION` environment variable (validated against `^1\.\d{1,3}$`).
