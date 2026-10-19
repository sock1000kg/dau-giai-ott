# Local Demo Stack & Operations Runbook (`scripts/demo.sh` / P2-T36)

This runbook covers one-command local demonstration stack management (`scripts/demo.sh` or npm scripts `demo:*`), system prerequisites, LAN spectator access, BTC round lifecycle controls, troubleshooting, and demo account provisioning.

---

## Quick Start

### 1. System Requirements
- **Docker**: Version ≥ 24.0 with Docker Compose v2 reachable (`docker compose`).
- **Python**: Python 3 (`python3`) installed on host (required for JSON processing and BTC operator CLI actions in `./scripts/demo.sh round`).
- **Memory**: Minimum ~4 GB RAM available for the local stack.
- **Ports**: Default `8080` for web gateway (customizable via `--port <PORT>`). Local datastores (PostgreSQL, Redis, SeaweedFS) dynamically bind to unused loopback ports. If port 8080 is already occupied, use `./scripts/demo.sh up --port <PORT>`.
- **Node.js**: Not required on the host for Docker operations.

### 2. Copy-Ready Lifecycle Workflow

```bash
# 1. Bring up the full demo stack (preflight, build, migrate, seed, wait healthy)
./scripts/demo.sh up

# 2. View demo accounts and verify CSV permissions (passwords are redacted from output)
./scripts/demo.sh accounts

# 3. Check container health, ready probe, and CSV status
./scripts/demo.sh status

# 4. View qualification round status as BTC operator
./scripts/demo.sh round status

# 5. Open round submissions (creates round and rule set if needed)
./scripts/demo.sh round open

# 6. Close submissions and schedule round matches
# NOTE: Starting round matches requires at least 2 teams with ACTIVE (gate-passed) submissions.
# For a full tournament demo sequence:
#   a. team01 and team02 log into the web UI (http://127.0.0.1:8080/) using password ABC123 and upload bots.
#   b. Wait until submissions reach ACTIVE status (check team page in the web UI).
#   c. Run './scripts/demo.sh round close' to close submissions and schedule matches.
# (If closed on a bot-less stack, submissions close to SUBMISSION_CLOSED but starting matches will exit non-zero).
./scripts/demo.sh round close

# 7. View tournament leaderboard and series results
./scripts/demo.sh round results

# 8. Follow logs from the stack or a specific service
./scripts/demo.sh logs api -f

# 9. Stop the running containers (data volumes preserved)
./scripts/demo.sh stop

# 10. Clean reset (removes containers, volumes, demo.env, and accounts.csv)
./scripts/demo.sh reset
```

Or run via root npm workspace shortcuts:
```bash
npm run demo:up
npm run demo:status
npm run demo:accounts
npm run demo:logs
npm run demo:round -- status
npm run demo:stop
npm run demo:reset
```

### 3. Accessing the Demo (Local & LAN)

When `./scripts/demo.sh up` completes, it displays the access URLs:
- **Local Machine**: `http://127.0.0.1:8080/`
- **Second Device on Same LAN / Wi-Fi**: `http://<LAN_IP>:8080/` (where `<LAN_IP>` is the host's LAN IP, e.g. `http://192.168.1.50:8080/`). The web gateway binds to `0.0.0.0:8080`, allowing colleagues or spectator devices on the same Wi-Fi network to browse match results, replays, and leaderboards without additional tunneling tools.

---

## Security Notes

> [!CAUTION]
> **Demo Mode Only — Public Password & Host Docker Socket Access**
> 1. **Public Credentials**: All demo accounts share the well-known password `ABC123`. Never run demo mode on shared, internet-facing, or production servers.
> 2. **Docker Socket Mount**: The worker and coordinator containers mount `/var/run/docker.sock` to execute sandbox runner containers. Mounting the Docker daemon socket is root-equivalent on the host. Do not run untrusted third-party code outside the sandbox corpus.
> 3. **Throw-Away Environment**: The demo environment file `.local/demo/demo.env` and credential export `.local/demo/accounts.csv` are git-ignored and intended solely for ephemeral local testing.

---

## Troubleshooting Guide

| Issue / Symptom | Probable Cause | Remediation |
|---|---|---|
| `Error: Port 8080 is already in use` | Another service is using port 8080 on the host. | Run `./scripts/demo.sh up --port 8081` (or another free port). |
| `DOCKER_GID` permission error / socket access denied | Worker/coordinator cannot communicate with Docker daemon socket. | Verify socket permissions: `ls -l /var/run/docker.sock`. Check that your host user belongs to the `docker` group (`getent group docker`). On Linux, `stat -c %g /var/run/docker.sock` detects the GID automatically. |
| Healthcheck timeout waiting for `/api/v1/health/ready` | A service failed to initialize or migrate within 180s. | Run `./scripts/demo.sh logs` to inspect recent errors across all services, or `./scripts/demo.sh logs api` / `migrate` specifically. |
| `demo.sh round open/close` refused with in-flight error | A tournament round is currently in `RUNNING` or `SETTLING` status, or is paused. | Round transitions fail-closed to prevent corrupting active match runs. Wait until the round settles, resume if paused, or check status with `./scripts/demo.sh round status`. (Note: `/api/v1/results/series` only returns terminal statuses `FINALIZED`/`CANCELLED`; in-flight protection checks round read models fail-closed). |
| `round close` fails starting round with 500 / `insufficient teams` | Round start requires ≥2 teams with `ACTIVE` submissions (`SCHEDULING_INSUFFICIENT_TEAMS`). | Have `team01` and `team02` log in at `http://127.0.0.1:8080/`, upload bot archives, and wait for preflight gate PASS (status `ACTIVE`). Then rerun `./scripts/demo.sh round close`. |
| Cannot login with demo accounts | Database seeding did not run or volume was corrupted. | Run `./scripts/demo.sh status` to verify `accounts.csv`. If necessary, run `./scripts/demo.sh reset` followed by `./scripts/demo.sh up`. |

---

## Demo Accounts & Seeder Reference (P2-T35)

This section documents the underlying demo account provisioning details, credential CSV format, and bootstrap alignment established in P2-T35.

## 1. Demo Accounts Overview

The demo seeder provisions three accounts with the public password `ABC123` (hashed using Argon2id):

| Username | Role | Team Name | Representative Email | Description |
|---|---|---|---|---|
| `btc` | `BTC_ADMIN` | *(none)* | *(none)* | Tournament administrator account for demo operations |
| `team01` | `TEAM_ACCOUNT` | `Team 01` | `team01@demo.invalid` | First participating team account |
| `team02` | `TEAM_ACCOUNT` | `Team 02` | `team02@demo.invalid` | Second participating team account |

- **Passwords at Rest**: The database stores only Argon2id password hashes (`$argon2id$v=19$...`). Plaintext passwords are never persisted in the database.
- **Log Privacy**: The seeder never prints plaintext passwords to stdout or stderr.

---

## 2. Credential CSV Export

When the seeder runs, it exports a CSV file with permissions mode `0600` inside a directory with permissions mode `0700` (`.local/demo/accounts.csv` by default, or the path set by `OTT_DEMO_ACCOUNTS_CSV`).

The file format is:
```csv
username,password,role,team
btc,ABC123,BTC_ADMIN,
team01,ABC123,TEAM_ACCOUNT,Team 01
team02,ABC123,TEAM_ACCOUNT,Team 02
```

- **Pre-existing non-demo passwords**: If an account already exists with a different password, the seeder retains the existing password hash, leaves the CSV password cell empty (`""`), and logs:
  `account <username> exists with a non-demo password; CSV cell left empty`
- **Git Ignore**: The `.local/` directory is git-ignored to prevent accidental credential commits.

---

## 3. Bootstrap Account Alignment

The local Compose stack automatically bootstraps an initial BTC admin via `OTT_BOOTSTRAP_BTC_USERNAME` and `OTT_BOOTSTRAP_BTC_PASSWORD`.

For seamless local demo operation:
- Set `OTT_BOOTSTRAP_BTC_USERNAME=btc`
- Set `OTT_BOOTSTRAP_BTC_PASSWORD=ABC123`

When configured this way:
1. The API service bootstrap creates `btc` on initial container launch.
2. The demo seeder subsequently runs, finds `btc` already present, verifies that its hash matches `ABC123`, and marks `created=false` while populating the demo CSV row.
3. If bootstrap used a different username, the seeder idempotently creates `btc` as a second BTC administrator.

---

## 4. Running the Seeder

### Option A: Via Docker Compose (Recommended for Local Stack)

Because Docker Compose may create a missing bind-mounted directory as root, ensure the directory exists with `0700` permissions on the host first:

```bash
mkdir -p -m 700 .local/demo
docker compose -f infra/local/compose.yaml --env-file .env --profile demo run --rm seed-demo
```

### Option B: Running Directly via npm / tsx

Ensure your database is running, migrations have been applied, and demo environment variables are set:

```bash
OTT_DEMO_MODE=true \
OTT_DEPLOYMENT_MODE=dev \
DATABASE_URL="postgres://ott_local:CHANGE_ME_POSTGRES_PASSWORD@127.0.0.1:5432/ott_local" \
  npm run demo:seed --workspace @ott/platform-api
```

---

## 5. Idempotency & Safety Guards

- **Safety Guards**:
  - `OTT_DEMO_MODE` must equal `true`.
  - `OTT_DEPLOYMENT_MODE` must equal `dev` or `test`.
  - If either guard fails, the seeder terminates immediately with a non-zero exit code, without connecting to or mutating the database and without creating the CSV.
- **Idempotency**:
  - Teams and accounts use `ON CONFLICT DO NOTHING`.
  - Re-running the seeder does not create duplicate rows or change existing hashes.
  - If `btc`, `team01`, or `team02` already exists with a different role or team binding, the seeder throws an error rather than proceeding in an inconsistent state.
- **Production Isolation**:
  - The demo seeder does not touch the production bulk provisioning (`teams/bulk.ts`) or reset flows.
