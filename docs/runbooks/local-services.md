# Runbook — Phase 2 local services

## Scope

`P2-T02` provides PostgreSQL, Redis and SeaweedFS for local
Phase 2 development. All published ports bind only to `127.0.0.1`; application
code is introduced by later tasks. `weed mini -bucket` creates the private
submission bucket idempotently at start.

## Prerequisites

- Docker Engine and Docker Compose v2 or newer.
- Node.js `^22.12.0` for Phase 2 packages once they exist.
- A local `.env`; do not commit it.

SeaweedFS runs with local-only S3 access credentials from `.env`; no license
file is required. The service image is pinned by digest in Compose.

## First start

From repository root:

```bash
cp .env.example .env
# Replace every CHANGE_ME value in .env with a distinct local-only secret.
docker compose -f infra/local/compose.yaml config
docker compose -f infra/local/compose.yaml up -d --wait
docker compose -f infra/local/compose.yaml ps
```

Expected services:

| Service | Local endpoint | Health condition |
| --- | --- | --- |
| PostgreSQL | `127.0.0.1:${POSTGRES_PORT}` | `pg_isready` against configured database/user |
| Redis | `127.0.0.1:${REDIS_PORT}` | authenticated `PING` |
| SeaweedFS S3 API | `http://127.0.0.1:${S3_API_PORT}` | `/cluster/status` |

SeaweedFS creates `${S3_BUCKET}` idempotently at startup. It publishes only the
S3 endpoint; management endpoints remain inside the Compose network.

## Local BTC bootstrap configuration

Set both `OTT_BOOTSTRAP_BTC_USERNAME` and `OTT_BOOTSTRAP_BTC_PASSWORD` in the
uncommitted `.env` only. They are consumed when the API host calls
`bootstrapBtcAdmin` before accepting requests; PostgreSQL stores only an
Argon2id hash. Do not place the resulting plaintext password in a command
history, issue tracker, audit record or repository file.

The bootstrap is idempotent for an existing BTC username. Leave both variables
absent to skip it. Setting only one variable is a configuration error and must
stop startup. Team credentials are not created here: they are created/reset by
the BTC-only team API in `P2-T06`.

The Phase 2 auth integration test needs explicit local connection URLs and
resets the selected PostgreSQL `public` schema and Redis database:

```bash
DATABASE_URL=postgresql://... REDIS_URL=redis://:...@127.0.0.1:6379 \
  npm test --workspace @ott/platform-api -- --run tests/auth.integration.test.ts
```

Never point that command at shared or production services.

## Lifecycle

```bash
# Stop containers but retain all local data.
docker compose -f infra/local/compose.yaml stop

# Start retained data again.
docker compose -f infra/local/compose.yaml up -d --wait

# Inspect logs.
docker compose -f infra/local/compose.yaml logs postgres redis seaweedfs
```

## Clean reset

This removes all local Phase 2 database, queue and object data. Confirm that
the current directory is this repository before running it:

```bash
docker compose -f infra/local/compose.yaml down -v
docker compose -f infra/local/compose.yaml up -d --wait
```

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Compose rejects a missing variable | Copy `.env.example` to `.env`; set every variable, especially each `CHANGE_ME` secret. |
| SeaweedFS exits before healthy | Inspect `docker compose -f infra/local/compose.yaml logs seaweedfs`; ensure port `${S3_API_PORT}` is free and the data volume is writable. |
| A port is unavailable | Change only the corresponding `*_PORT` in `.env`, then run `up -d --wait` again. |
| Services retain unwanted state | Use the explicit clean-reset command above; it deletes the named Docker volumes. |

## AWS S3 migration boundary

Later application code uses only AWS SDK v3 S3 operations. For local SeaweedFS,
set `S3_ENDPOINT` and `S3_FORCE_PATH_STYLE=true`. For AWS S3, leave endpoint
unset, set `S3_FORCE_PATH_STYLE=false`, use the target region and inject IAM
credentials outside the repository. Copy existing objects, then verify every
object key, byte size and stored SHA-256 before switching readers.
