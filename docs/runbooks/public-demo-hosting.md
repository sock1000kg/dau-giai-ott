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
- **Tournament Administrator (`btc`)**: Seeded with a private 32-character random password. This password is meant strictly for the tournament operator and must never be shared with testers.
- **Tester Teams (`team01` through `team10`)**: Seeded with **one shared 12-character tester password** (`OTT_DEMO_TEAM_PASSWORD`) generated using base62 characters excluding ambiguous glyphs (`0O1lI`). All ten teams share this single password.

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

To inspect the generated credentials:

```bash
# Print safe overview (passwords redacted)
./scripts/demo.sh accounts

# Print full CSV including unredacted passwords to stdout
./scripts/demo.sh accounts --reveal
```

### Handout Procedure
1. Run `./scripts/demo.sh accounts --reveal` to obtain the credentials.
2. Note the private `btc` password and keep it strictly confidential for tournament management.
3. Share the public web URL and the **single shared tester password** with your participants.
4. Testers can log into any unused team account (`team01` through `team10`) using the shared password.

Example invitation message:
```text
Welcome to the OTT Tournament Demo!
Web Portal: https://<your-public-tunnel-domain>/
Usernames: team01 through team10 (pick any unused team)
Tester Password: <shared-tester-password>
```

---

## 4. Running the Tournament

### Step 1: Open Submissions
As the tournament administrator (BTC), open the qualification round:

```bash
./scripts/demo.sh round open --yes
```

This verifies or creates the tournament stage and rule set, transitioning the round to `SUBMISSION_OPEN`.

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
  - Pre-built local Docker images (rebuilding is skipped).
  - Existing login passwords for `btc` and `team01`..`team10`. Note that password hashes inside PostgreSQL are freshly computed with new salts upon re-seeding, but they match the preserved passwords.

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

- **Shared Tester Password Model**: All tester teams (`team01` through `team10`) share the same password. Any tester possessing the password can log in as any team account. This model is intended solely for trial demonstrations and informal testing, not untrusted competitive tournaments.
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
