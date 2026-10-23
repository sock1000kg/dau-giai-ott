# Public snapshot v1

P3-L05 uses a static read model, separate from authenticated application routes.
`/public` reads only `/snapshots/latest.json` and the immutable artifact it names.
The coordinator publishes every `OTT_COORD_SNAPSHOT_INTERVAL_MS` (default 5 seconds), so an opened round is visible within about 15 seconds.
When the newest round's rules fail validation or the stored hash does not match, the iteration is skipped and the log says which check failed (`reason`, invalid `paths`; never the rules).
There is no public endpoint that queries the database or execution worker.

## Files and cache

`latest.json` contains `{schemaVersion:1,file,sha256,updatedAt}`. `file` must be
exactly `snapshot-<sha256>.json`, with a lowercase 64-character hexadecimal digest.
The digest covers the exact UTF-8 artifact bytes, including its final newline.
Serve the pointer with `Cache-Control: no-cache` and immutable artifacts with
`Cache-Control: public, max-age=31536000, immutable`. Polling runs every 10 seconds
after the previous request completes; no overlapping polling requests.

The DTO is `PublicSnapshot`, exported by `@ott/platform-api`. See the runnable
[example](fixtures/public-snapshot-v1.json) for all fields. It includes round
status, ordered queue positions and estimated seconds (null means unknown),
official results/ratings/eligibility, rule version and engine, rule sections,
schedule, announcements, FAQ and incident status/ETA. Rules sections must contain
the locked round's map IDs/checksums/layout, changelog, time control, maxTurns,
fault policy and resource limits. Text is displayed as plain text, never HTML.

The producer reads announced locked qualification rules and current results in a
read-only repeatable-read PostgreSQL transaction. It reuses the official leaderboard
query and eligibility function, and receives the execution queue's ordered match IDs
from BullMQ (active, prioritized, waiting). ETA is null until a reliable duration
estimate is available. Missing/unavailable jobs are not assigned fictitious positions.
Draft rules and invalid rule checksums fail closed. Official scores/ranks are not recomputed
in the browser. No seed, object key, stderr, account, submission or private replay
URL is projected. Qualification results always have replay availability cleared.
Finals links require both `syncVerified` and `replayPublished`; the producer sets
these only after verified import and replay publication. Replay authorization
continues to be enforced by the existing replay endpoint.

## Publishing

From the repository root, with Node 22 and installed workspaces:

```sh
npx tsx src/platform/api/src/modules/public-snapshots/cli.ts docs/contracts/fixtures/public-snapshot-v1.json src/platform/web/public/snapshots
npm run dev --workspace @ott/platform-web
```

Open `/public`. Replace the example input with current approved public data.
Control-plane code may call `publishPublicSnapshot(directory, dto)` instead.
For live qualification data, set `DATABASE_URL` and `REDIS_URL`, then run:

```sh
npx tsx src/platform/api/src/modules/public-snapshots/live.ts src/platform/web/public/snapshots docs/contracts/fixtures/public-editorial-v1.json
```

This process refreshes every 30 seconds, rereads editorial/status content on each
pass, and keeps old files on a DB/queue/publish failure. Append `--once` for one pass.
It handles SIGINT/SIGTERM and closes its own connections. It reads execution queues
without consuming or modifying jobs. No process or deployment is started implicitly.
Finals remains a prepared DTO input via the one-shot publisher until the finals
sync domain is available; its verified/published flags must come from that domain.
Use one publisher per output directory and a local
filesystem supporting hard links and atomic rename. Upload immutable artifacts
to static hosting before replacing `latest.json`; never remove the last good
artifact during synchronization. Keep previous artifacts for cached clients.

The publisher validates/project fields, writes complete content before making
the immutable name visible, verifies an existing artifact before reuse, and
atomically replaces the pointer last. Failures leave the previous pointer intact.
The browser verifies checksum/schema/time before replacing its in-memory last
good snapshot. Failed polls, tampering and older updates retain the displayed
snapshot. An age over 90 seconds displays a stale warning even if polling works.
Updated-at and the most recently published incident ETA remain visible; an ETA
cannot be updated during a total publisher outage.

## Verification

```sh
npm test --workspace @ott/platform-api -- public-snapshots
npm test --workspace @ott/platform-web -- public-site
npm run build --workspace @ott/platform-web
node scripts/load-public-snapshots.mjs src/platform/web/public/snapshots 1000
```

The load command starts an isolated static HTTP server and simulates 1,000 clients,
each fetching the pointer and checksummed artifact over a pool capped at 100
physical connections (all logical clients start together); its JSON output is a local
AC-14 supporting artifact. A deployed CDN/server-lab run measuring concurrent
match duration is still required to sign off full AC-14 at the project checkpoint.
