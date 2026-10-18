# P3-L05 local verification — 2026-10-18

Branch: `longt/feat-p3-l05-public-snapshots`, based on `origin/main` at `ad6bf63`.
Runtime: Node.js 22.23.3, Windows. This is local evidence, not checkpoint approval.

## Checks

- Publisher: 4 passing tests (content address/checksum, idempotency, explicit
  projection/privacy, finals guards, write failure preserves last pointer).
- Live producer: 2 passing PostgreSQL integration tests in an isolated schema,
  including locked rules, official leaderboard/results, ordered queue projection,
  privacy and producer failure preserving the last published pointer.
- Full web suite: 133 passing tests in 18 files, including 5 public-site tests.
- API typecheck and web production build passed. The browser imports only the
  public DTO type from the API; Node filesystem/crypto code is erased from imports
  and is not part of the browser bundle.
- CLI published the committed demo fixture, then the static HTTP load ran:

```json
{
  "scenario": "local-static-only",
  "clients": 1000,
  "successful": 1000,
  "requests": 2000,
  "elapsedMs": 1091,
  "p95Ms": 1036,
  "databaseConnections": 0,
  "workerRequests": 0,
  "maxConcurrentConnections": 100
}
```

All logical clients start together, sharing a bounded connection pool. The
unbounded-socket attempt failed with `ECONNREFUSED` on this Windows host; the
checked-in tool explicitly reports its pool limit. It does not demonstrate
1,000 independent simultaneous network sockets or concurrent match performance.
Only the pointer and one content-addressed JSON artifact were requested.

## Integration and limits

`publishPublicSnapshot(directory, dto)` and its one-shot CLI are usable now.
The one-shot CLI accepts prepared public data. `live.ts` supplies qualification
data from PostgreSQL and queue ordering from Redis, refreshing every 30 seconds.
Operations must configure its environment and approved editorial/status JSON.
No hosting deployment or production process was enabled by this change. Finals
uses the prepared DTO interface until its future verified-sync domain exists.
The demo is explicitly marked as demo. The Redis CLI path was typechecked;
the PostgreSQL collector was exercised against a real database.

The page is `/public`; legacy `/leaderboard` and authenticated flows remain
available separately. Its own leaderboard navigation stays within the static page.
Browser behavior was verified in DOM tests, not a real browser session.

Full AC-14 still requires a server-lab/CDN run while official matches execute,
with timing comparison and project sign-off. L05 remains unchecked until that
external evidence and the configured live deployment have been verified.

DOCS UPDATED: `docs/contracts/public-snapshot-v1.md`, its example fixture,
`docs/README.md`, `tasks/todo.md`, and this report.
