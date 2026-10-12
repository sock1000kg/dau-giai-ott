# `@ott/platform-worker`

Execution-plane BullMQ consumer for versioned `MatchJobV1` messages. It is a
separate process from the API; it imports only the public `@ott/job-contract`
and does not run routes, database calls, sandbox code, or game logic in this
task. P2-T10/T11 provide the `processMatch` implementation.

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
```
