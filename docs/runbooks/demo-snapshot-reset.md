# Hourly demo snapshot restore

This runbook is for a separate `ott-demo-reset` dev/test stack. The public
`ott-demo` project must remain untouched. Each restore
replaces PostgreSQL, SeaweedFS artifacts (including replay and OCI objects),
and public snapshots with one verified baseline. It clears Redis sessions and
queues, resets `team01`–`team04` through the existing allowlisted password
command, and checks readiness before reporting success. BTC credentials stay
owned by the private demo environment file.

Never install this workflow while `DEMO_PUBLIC=true`, hosted PoC or finals mode
is active. The reset takes away all changes since the baseline, including new
submissions, matches, password changes, and queue state.

## Build and verify a baseline

Run from the repository checkout connected to the target Compose project. The
target must be an absolute path outside tracked Git files, for example under
the ignored `.local/demo/` directory. The output directory is immutable and
created with mode `0700`; its payloads and manifest use `0600`.

```bash
docker pull busybox:1.36.1
OTT_DEMO_SNAPSHOT_ENABLED=true \
OTT_DEMO_MODE=true OTT_DEPLOYMENT_MODE=dev DEMO_PUBLIC=false \
  bash scripts/demo-snapshot.sh create /opt/ott/.local/demo-reset/baseline
bash scripts/demo-snapshot.sh verify /opt/ott/.local/demo-reset/baseline
```

The v2 bundle contains `data/database.dump`, `data/seaweedfs-objects.tar.gz`,
`data/snapshots.tar.gz`, `manifest.json`, and `checksums.sha256`. S3 objects are
exported by key and restored through the S3 API into a fresh SeaweedFS volume;
raw SeaweedFS volume files are not portable snapshot payloads. Export refuses
to create a baseline if a database reference is absent or its object digest
does not match. The manifest records the source commit, account/team/match/replay
row counts, S3 object/reference counts, and public snapshot file count. It does
not contain Redis, environment files, or the credentials CSV. Keep the bundle
root-only and create an independent recovery backup before the first restore
against a live demo server.

For an audience-facing baseline, include at least one `FINALS` replay in
`PUBLISHED` state and open its anonymous replay URL before accepting the
bundle. A replay row and its S3 object can be intact while the public endpoint
still returns 404 when the series is not in the public finals stage.

## Restore once by hand

Set these values in the private demo env/config before restoring:

```text
OTT_DEMO_MODE=true
OTT_DEPLOYMENT_MODE=dev
DEMO_PUBLIC=false
OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES=team01,team02,team03,team04
OTT_DEMO_TEAM_PASSWORD=<the public demo test password configured for the teams>
```

`OTT_DEMO_TEAM_PASSWORD` must match the stable public test-account CSV. Keep
the server env file private (`0600`); the value is deliberately not copied into
the cron configuration or logs. Do not put BTC credentials in the team CSV.
The cron installer checks this equality without printing the password and
refuses to install if the CSV/default configuration differ.

Run one manual restore and inspect the result before enabling a schedule:

```bash
OTT_DEMO_SNAPSHOT_RESTORE_ENABLED=true \
OTT_DEMO_MODE=true OTT_DEPLOYMENT_MODE=dev OTT_DEMO_PUBLIC=false \
OTT_DEMO_PASSWORD_RESET_TEAM_USERNAMES=team01,team02,team03,team04 \
  bash scripts/demo.sh restore-demo /opt/ott/.local/demo-reset/baseline
```

The command asks for the exact Compose project name. Add `--yes` for a
non-interactive one-off run. It verifies checksums before stopping services,
uses a project lock, refuses an active container password scheduler, and
removes only the SeaweedFS and `snapshots` volumes whose Compose project/key
labels match the selected `ott-demo*` project. It keeps application writers
stopped while restoring storage, applying migrations, resetting team
passwords, and checking database counts. It starts the application only after
those invariants pass. If an attempt failed before startup, the next restore
resolves project volumes by their Compose labels and can retry without a
running web container. On any failed invariant, it exits non-zero and does not
claim success.

## Install the OS crontab

Create a private config based on
[`config/demo-reset-cron.example.env`](../../config/demo-reset-cron.example.env),
substitute the absolute checkout/release and baseline paths, then set owner and
mode `0600`. The installer modifies only its own marked block in the current
OS user's crontab and preserves other entries.

```bash
install -m 0600 /dev/null /etc/ott-demo-reset.env
# Populate the file from the example without adding any password value.
chmod 0600 /etc/ott-demo-reset.env
bash scripts/install-demo-reset-cron.sh install /etc/ott-demo-reset.env
bash scripts/install-demo-reset-cron.sh status
bash scripts/install-demo-reset-cron.sh run-now /etc/ott-demo-reset.env
```

The example schedule is `0 * * * *` in `Asia/Ho_Chi_Minh`. The cron uses
`flock`, a 20-minute timeout, and a private rotating log. The installed command
passes only the fixed team allowlist and demo mode flags. It reads the default
team password from the private Compose env file. Do not enable Compose profile
`demo-password-reset` at the same time; that profile only resets passwords and
is not the full snapshot restore scheduler.

Rollback the schedule with:

```bash
bash scripts/install-demo-reset-cron.sh uninstall
```

## Verification checklist

- `demo:snapshot:test` passes, including manifest/checksum tampering, public
  mode refusal, cron idempotency and unrelated-crontab preservation.
- A disposable-stack manual restore returns PostgreSQL, all S3 objects and
  public snapshots to the same baseline counts twice in a row. Confirm each DB
  reference resolves to an object whose SHA-256 matches the database record.
- `team01`–`team04` authenticate with the public team test password; their old
  sessions are revoked. BTC still authenticates with its private credential.
- Leaderboard, match history and replay load through the web gateway after
  restore; `/api/v1/health/ready` is healthy.
- Only after this drill passes should the current user's crontab be installed.
