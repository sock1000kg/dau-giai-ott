# Public Demo Hosting Runbook (`scripts/demo.sh up --public`)

This runbook guides operators hosting a multi-player demonstration of the OTT Tournament platform for external testers over a public reverse proxy or tunnel (such as Cloudflare Tunnel).

---

## 1. Overview & Requirements

Public demo mode provisions **10 team accounts** (`team01`..`team10`) plus the tournament administrator (`btc`), configures `OTT_SECURE_COOKIES=true` for HTTPS tunnel compatibility, and provides automated, non-destructive data resets via `demo.sh refresh`.

### Host Machine Requirements
- **Operating System**: Linux host (x86_64 or aarch64). Docker Desktop socket and UID/GID translation on macOS is not supported.
- **Hardware Resources**: Minimum ~4 GB RAM, 2 CPU cores, and 10 GB free disk space.
- **Network**: Outbound internet access is required during the first run to pull base images and build containers.
- **Docker**: Engine version ≥ 24.0 with Docker Compose v2 reachable (`docker compose version`).
- **Python**: Python 3 (`python3`) installed on the host for CLI parsing and tournament round controls.
- **Dedicated Host / VM**: The worker and coordinator containers mount `/var/run/docker.sock` to execute sandbox runner containers. Mounting the host Docker daemon socket is **root-equivalent on that host**. You should run the demo on a **dedicated host or virtual machine**, not a shared multi-tenant server.

### Demo Authentication Model
The public demo accounts are **fixed and public on purpose**: anyone with the URL may log in, including as `btc`, and try every feature. This is safe because all data is wiped and re-imported on a schedule (`refresh`, see below). The single source of truth is the committed file [`demo/accounts.csv`](../../demo/accounts.csv); `./scripts/demo.sh up --public` reads the credentials and the number of teams from it (override the path with `OTT_DEMO_PUBLIC_ACCOUNTS_CSV` only for tests). Do not put real secrets in any account.

- **Tournament Administrator (`btc`)**: password from the `btc` row of `demo/accounts.csv`.
- **Tester Teams (`team01` … `team10`)**: one shared password from the `team*` rows (all rows must share it). Teams may change their own password in the UI; the next `refresh` restores the CSV value.
- **Reset = back to the CSV.** `./scripts/demo.sh refresh --yes` first re-reads `demo/accounts.csv` (validated; an invalid file stops the refresh before anything is touched), rewrites the account keys in `.local/demo/demo.env`, wipes all data and re-seeds exactly these accounts. After a `git pull` that changes the CSV, the next refresh applies it.
- Infrastructure passwords (PostgreSQL, Redis, S3) are still random and live only in `.local/demo/demo.env`.
- The scheduled reset-to-default job is not part of `--public` mode and must remain disabled there. The scheduled data reset is `refresh --yes` (cron), not this password-reset job. Never set `OTT_DEMO_PASSWORD_RESET_ENABLED=true` on a public demo host.

---

## 2. Installation & Starting the Demo Stack

### Clone and Launch
Run the following copy-ready commands on your dedicated Linux host:

```bash
git clone <repo> /opt/ott && cd /opt/ott && git checkout main && ./scripts/demo.sh up --public --port 8080
```

### Tunnel Host Binding
If your tunnel daemon (e.g. `cloudflared`) runs on the same machine, bind the gateway strictly to loopback so port 8080 is not exposed to the local network:

```bash
./scripts/demo.sh up --public --bind 127.0.0.1 --port 8080
```

### Pointing the Tunnel
Point your tunnel daemon at `http://localhost:8080` (or `http://127.0.0.1:8080`):

```bash
cloudflared tunnel --url http://localhost:8080
```

- **Single Origin**: The gateway reverse proxy serves both the static web frontend SPA (`/`) and API routes (`/api/v1/`) on the same origin. A single public hostname is sufficient.
- **No WebSockets**: The web client uses HTTP polling and static qualification snapshots; WebSocket proxying is not required.
- **TLS Termination**: TLS is terminated at the tunnel edge. Communication between the tunnel daemon and the local gateway is plain HTTP.

---

## 3. Distributing Credentials

The credentials file `.local/demo/accounts.csv` is written with restrictive `0600` permissions and is git-ignored.

The credentials are the rows of [`demo/accounts.csv`](../../demo/accounts.csv). `./scripts/demo.sh accounts` prints the seeded CSV (`.local/demo/accounts.csv`) with passwords redacted; add `--reveal` to print it in full (it will match `demo/accounts.csv`).

### Handout Procedure
1. Share the public web URL and `demo/accounts.csv` (or just the usernames `team01` … `team10` and the shared team password from it).
2. Testers can log into any team account; the `btc` account (password in the CSV) is also open on purpose so everybody can try the tournament-administrator features.
3. Remind everyone that the demo is wiped on a schedule.

Example invitation message:
```text
Welcome to the OTT Tournament Demo!
Web Portal: https://<your-public-tunnel-domain>/
Accounts: see demo/accounts.csv in the repository (btc, team01 … team10)
Everything is reset on a schedule - feel free to break things.
Download pre-built demo bot (.oci.tar): https://<your-public-tunnel-domain>/downloads/ott-demo-bot-go-v1.oci.tar
```

Testers can download the pre-built demo bot `ott-demo-bot-go-v1.oci.tar` directly from the public tournament page or the link above, upload it as their initial submission, or test against the seeded BTC baseline (`btc-baseline`) opponent on the test-run page.

The public demo stack also pre-seeds a completed finals tournament ResultBundle (`demo-finals-key`), allowing testers to explore the interactive finals bracket and sample replays under `/finals` with a demo notice footer.

---

## 4. Running the Tournament

### Step 1: Open Submissions
As the tournament administrator (BTC), open the qualification round:

```bash
./scripts/demo.sh round open --yes
```

This verifies or creates the tournament stage and rule set, transitioning the round to `SUBMISSION_OPEN`. (Note: rounds already opened with an older rule set template keep their locked rules, so self-play stays unavailable until BTC opens a new round or rule set allowing own submissions).

### Step 2: Bot Submissions
Each tester navigates to the web portal in their browser:
1. Logs in with their selected `teamXX` account.
2. Navigates to the **Submissions** tab.
3. Uploads an OCI bot image archive.
4. The coordinator automatically evaluates preflight sandbox checks; upon passing, the submission reaches `ACTIVE` status.

### Step 3: Monitor Round Status
The BTC operator can inspect current round progress from the terminal:

```bash
./scripts/demo.sh round status
```

### Step 4: Close Submissions & Run Matches
Once participants have submitted their bots (at least 2 teams with `ACTIVE` submissions required):

```bash
./scripts/demo.sh round close --yes
```

This closes the submission window and schedules round-robin matches for the coordinator and worker fleet.

### Step 5: View Results & Standings
View updated leaderboard rankings and match results from the command line:

```bash
./scripts/demo.sh round results
```

Testers and spectators can also follow match replays and leaderboard rankings interactively in the web UI.

---

## 5. Daily Reset & Maintenance

During multi-day testing events, you can reset test submissions and matches each night while keeping tester credentials intact.

### Non-Destructive Data Refresh (`refresh`)
`demo.sh refresh` resets data volumes and brings the stack back up fresh:

```bash
# Interactive (requires confirmation)
./scripts/demo.sh refresh

# Non-interactive (bypasses prompt, suitable for cron)
./scripts/demo.sh refresh --yes
```

- **Downtime Notice**: `demo.sh refresh` is **not zero-downtime**. It stops containers and destroys data volumes before restarting them, making the site temporarily unavailable. Total downtime is typically a few minutes (measured at ~27 seconds to ~1 minute on test environments).
- **What Refresh Wipes**:
  - PostgreSQL database tables (all rounds, submissions, and match outcomes).
  - Redis session store and job queues.
  - SeaweedFS S3 object storage (all uploaded bot archives).
  - Web qualification snapshot cache directory.
- **What Refresh Keeps**:
  - Configuration file `.local/demo/demo.env`.
  - Credentials file `.local/demo/accounts.csv`.
  - Editorial file `.local/demo/editorial/public.json`.
  - Pre-built local Docker images (rebuilding is skipped).
  - Existing login passwords for `btc` and `team01`..`team10`. Note that password hashes inside PostgreSQL are freshly computed with new salts upon re-seeding, but they match the preserved passwords.

### Announcements & Editorial Management
Announcements on the public page come from `.local/demo/editorial/public.json`, which is mounted into the coordinator at `/editorial/public.json` and re-read on every snapshot publish (every ~5 seconds).

- View the file path and example announcement structure:
  ```bash
  ./scripts/demo.sh editorial
  ```
- To update announcements, edit `.local/demo/editorial/public.json` directly. The coordinator will publish the updated announcements in the next snapshot cycle automatically without restarting containers.
- The editorial file is preserved across both `demo.sh refresh` and `demo.sh reset`.

### Recommended Daily Cron
To automatically reset the demo environment every morning at 04:00 AM:

```cron
0 4 * * * cd /opt/ott && ./scripts/demo.sh refresh --yes >> .local/demo/refresh.log 2>&1
```

### Concurrency Lock & Project Guards
- **Concurrency Locking**: `demo.sh refresh` acquires an exclusive file lock on `.local/demo/demo.env.lock` via `flock`. The lock is held on an open file descriptor and is automatically released when the process terminates. **Do not manually delete this lock file.** If `flock` is unavailable on the host, a directory lock `.local/demo/demo.env.lock_dir` is used; stale directory locks whose PID is no longer alive are cleaned up automatically.
- **Project Pattern Guard**: Verifies that the Compose project name matches the regular expression `^ott-demo[a-z0-9-]*$`.

### Full Nuclear Reset (`reset`)
If credentials leak or you want to wipe everything and regenerate completely new passwords:

```bash
./scripts/demo.sh reset --yes && ./scripts/demo.sh up --public
```

---

## 6. Common Operations

- **Update to Latest Version**:
  ```bash
  git pull && ./scripts/demo.sh up --public
  ```
- **Inspect Service Status**:
  ```bash
  ./scripts/demo.sh status
  ```
- **Tail Service Logs**:
  ```bash
  ./scripts/demo.sh logs api -f
  ./scripts/demo.sh logs coordinator -f
  ./scripts/demo.sh logs worker -f
  ```
- **Stop Containers** (data preserved):
  ```bash
  ./scripts/demo.sh stop
  ```

---

## 7. Known Limits & Security Considerations

- **Public Credentials By Design**: `btc` and all `team*` accounts use the passwords published in `demo/accounts.csv`. Anyone can act as BTC (create, open, cancel and start rounds), upload arbitrary OCI bots that run in the sandbox, and change team passwords until the next reset. The scheduled `refresh --yes` (see the cron line) is therefore **mandatory**, not optional. Because the worker and coordinator mount the Docker socket (root-equivalent on the host), host the demo on a dedicated VM that holds nothing else of value.
- **Development Mode (`OTT_DEPLOYMENT_MODE=dev`)**: The demo stack runs in `dev` mode to enable the seed endpoint and relaxed authentication configurations.
- **Unencrypted Origin**: The web gateway listens on plain HTTP (`APP_PORT`). You must terminate TLS at your reverse proxy or tunnel edge.
- **Secure Cookie Flags**: When `OTT_SECURE_COOKIES=true` is set (default in `--public` mode), Fastify sets `secure: true` on cookies (`src/platform/api/src/modules/auth/plugin.ts` lines 184, 319). The session cookie `ott_session` also carries `httpOnly: true` and `sameSite: 'lax'` (lines 180–183, 315–318), while the MFA challenge cookie carries `sameSite: 'strict'` (line 164).
- **Shared Tunnel Egress IP**: Because all remote testers connect through the tunnel proxy, the API sees requests arriving from the tunnel daemon's egress IP. IP-based rate limiting buckets are therefore shared across all testers.
- **Password Changes at Rest**: If you edit `OTT_DEMO_*` passwords or team count in `.local/demo/demo.env` after initial startup, existing database account hashes are **not modified** until a `refresh` or `reset` recreates the database.

---

## 8. Troubleshooting Guide

| Issue / Error | Cause | Remediation |
|---|---|---|
| `Port 8080 is already in use` | Another host process occupies port 8080. | Launch with another port: `./scripts/demo.sh up --public --port 8081`. |
| Healthcheck timeout waiting for `/api/v1/health/ready` | API or backend services failed initialization or database migrations. | Check container logs: `./scripts/demo.sh logs api` and `./scripts/demo.sh logs coordinator`. |
| `DOCKER_GID` permission error / socket access denied | Worker/coordinator cannot communicate with Docker daemon socket. | Verify host socket permissions (`ls -l /var/run/docker.sock`). `demo.sh` automatically probes the container socket GID. |
| `Error: no demo env at .local/demo/demo.env; run demo.sh up [--public] first` | `demo.sh refresh` was run on a system without an existing demo environment. | Bring up the stack first: `./scripts/demo.sh up --public`. |
| `Another demo.sh refresh is currently running` | Concurrent refresh attempted or lock held. | With `flock`, the lock on `.local/demo/demo.env.lock` releases automatically on process exit. If using fallback `.local/demo/demo.env.lock_dir`, verify no other refresh process is running before removing the directory. |
| `round close` fails with `insufficient teams` | Fewer than 2 teams have `ACTIVE` submissions. | At least two teams must upload valid bots that pass preflight sandbox validation before match scheduling can proceed. |
