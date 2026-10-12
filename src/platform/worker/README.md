# `@ott/platform-worker`

Execution-plane BullMQ consumer for versioned `MatchJobV1` messages. It is a
separate process from the API. It imports the public job contract and exposes a
Docker-backed `SandboxOciBotPort`; P2-T11 composes the port with MatchRunner and
result finalization. Only this trusted worker may access the Docker Engine
socket. The socket is never mounted into a bot container.

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
