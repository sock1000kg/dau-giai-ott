# P2-T64 hourly demo reset acceptance

**State:** accepted after two scheduled hourly cycles passed on `jump-jits`.

**Owner approval:** Đinh Đức Thuận approved the P2-F server and browser evidence on 2026-10-26.

## Release and isolation

- Host: `jump-jits` (OS cron user `root`; host timezone `Asia/Bangkok`).
- Main release: `18ec000caf7a24f6b35c03c6d156710b6874f49d`.
- Merged PRs: [#82](https://github.com/sock1000kg/dau-giai-ott/pull/82), [#83](https://github.com/sock1000kg/dau-giai-ott/pull/83), [#84](https://github.com/sock1000kg/dau-giai-ott/pull/84), [#85](https://github.com/sock1000kg/dau-giai-ott/pull/85), [#86](https://github.com/sock1000kg/dau-giai-ott/pull/86).
- Dedicated checkout: `/opt/ott/releases/18ec000caf7a24f6b35c03c6d156710b6874f49d`.
- Dedicated Compose project: `ott-demo-reset`; app gateway binds only to `127.0.0.1:18080`. Postgres, Redis and S3 ports bind only to loopback at `18281`, `18282`, and `18283`.
- Root-only environment, account file, cron config and bundles live under `/opt/ott/.local/demo-reset` (`0700` directories, `0600` files). The public `ott-demo` Compose project was not changed.
- Crontab entry: `0 * * * *`, `CRON_TZ=Asia/Ho_Chi_Minh`, protected by `flock` and a 20-minute timeout. Installer `status`, `uninstall`, reinstall and log rotation were exercised on the host.

## Baseline and recovery bundles

Both bundles are outside Git, root-only, and passed `demo-snapshot.sh verify`.

| Bundle | Path | Checksums file SHA-256 | Manifest source commit |
| --- | --- | --- | --- |
| Active baseline | `/opt/ott/.local/demo-reset/baseline` | `7f345a193d848ed9f0c4797dedee73a95708bda8d2cf911ee645d5ef72c31380` | `4783df8f616051ad2d7010bbda98661848151105` |
| Independent recovery | `/opt/ott/.local/demo-reset/recovery-pre-drill` | `b819ec0d1da319168a3466270d51f5e7d3548cbbc1baeca6bca3d309dc3c931d` | `4783df8f616051ad2d7010bbda98661848151105` |

Both manifests report 10 teams, 11 accounts, 5 demo accounts, 2 matches, 2
replays, 11 S3 objects, 11 database object references, and 25 public snapshot
files. The final baseline includes two published finals replays and the
anonymous replay route returned content during the browser check.

## Manual restore and browser checks

- Manual `run-now` completed at `2026-10-26 14:32:04 +07:00`; a later log-rotation
  rehearsal completed at `14:49:26 +07:00`. Both ended with readiness healthy.
- After changing team01's password, default login returned HTTP 200, the changed
  password returned 401, and its pre-restore session returned 401. BTC login
  with its private credential returned 200. Readiness returned 200.
- Chrome DevTools Protocol browser checks through an SSH tunnel: BTC login from
  `/admin/teams` landed on `/admin`; team01 login from `/team/password` landed
  on `/team`; neither went to `/`. Anonymous leaderboard and replay pages
  rendered at 1280×800 and 390×844 with no horizontal overflow and no failing
  network requests after the initial unauthenticated session check.
- The cron lock refused a concurrent `run-now`. Log rotation moved an 11 MiB
  test log to `.1`, created a new `0600` log, and the temporary rotated file was
  removed after the check.
- Root `npm run typecheck` and `npm run build` passed. Root `npm test` passed:
  46 game-core, 55 bot-protocol, 192 match-runner, 7 job-contract, 569 API
  (157 skipped), 184 worker (18 skipped), 473 web, 4 corpus, and 20 root tests.

## Automatic hourly cycles

Record each cycle after the cron-launched process exits. Each row must include
the log start/finish timestamps, reset outcomes for all four teams, BTC login,
session revocation, object/database invariants, readiness and public replay.

| Cycle | Scheduled time (+07:00) | Restore finished | Team passwords / old session | BTC | DB/S3/snapshots / readiness / replay |
| --- | --- | --- | --- | --- | --- |
| 1 | 15:00 | 15:00:45 | team01–team04 default login 200; changed team01 password 401; pre-reset session 401 | private BTC login 200 | 10 teams, 11 accounts, 2 matches, 2 replays, 11/11 S3 refs, 25 snapshots; readiness 200; leaderboard/replay pass desktop/mobile |
| 2 | 16:00 | 16:00:44 | team01–team04 default login 200; changed team01 password 401; pre-reset session 401 | private BTC login 200 | 10 teams, 11 accounts, 2 matches, 2 replays, 11/11 S3 refs, 25 snapshots; readiness 200; leaderboard/replay pass desktop/mobile |

## Test and review notes

- `npm run demo:snapshot:test`, shell syntax checks, Compose config validation,
  root typecheck/build/test, and local isolated restore/browser checks passed.
- GitNexus detected 17 changed files/9 documentation symbols with low risk for
  the main implementation; the index did not map the shell helper functions,
  which were directly reviewed and exercised on a disposable stack and host.
- `npm audit` reports a moderate transitive `fast-uri` advisory and a low
  `fastify` advisory in the existing lockfile. Dependencies were not changed by
  this demo-reset task; the deployed gateway is loopback-only.
