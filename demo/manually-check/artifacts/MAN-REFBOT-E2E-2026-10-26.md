# E2E browser evidence — BTC reference bot portal

- Date: 2026-10-26 (Asia/Ho_Chi_Minh)
- Branch: `thuandd/feat-p3-n10-btc-reference-bot-portal`
- Base commit: `f16eafd`
- Environment: isolated local Compose project, `http://127.0.0.1:28080`; Chrome 154 headless; PostgreSQL, Redis and SeaweedFS were healthy.
- Data: fresh demo seed with `btc-baseline`, `btc`, `team01`, `team02`; no credentials recorded here.

| Case | Result | Evidence |
| --- | --- | --- |
| Anonymous access and BTC menu/page | PASS — anonymous user redirected to login; BTC saw menu and page | Admin desktop screenshot |
| OCI upload | PASS — 19 MiB `team-test-run-first-legal.oci.tar` validated and appeared disabled | Admin desktop screenshot; API SHA-256 matched `60b14b1f574d80f8ca3a2efe79dbd9597a11382aa865c582a5251078d948ca08` |
| Invalid, duplicate and oversize archives | PASS — invalid archive created no row; duplicate showed specific message; 257 MiB file was rejected client-side | Browser assertions |
| Activate and team policy | PASS — second bot activated while baseline remained active; team policy listed both bots | Team policy screenshot; browser/API assertions |
| Team authorization | PASS — team UI denied `/admin/reference-bots`; API returned 403 `FORBIDDEN` | Browser/API assertions |
| Disable and policy refresh | PASS — disabled bot disappeared from policy for new test runs | Browser/API assertion |
| Responsive layout and keyboard | PASS — at 390 px, document width stayed 390 px; Tab advanced to the first focusable brand link | Admin mobile screenshot; browser assertion |
| Audit integrity | PASS — upload/activate/disable audit `target_id` matched the bot UUID in audit details | PostgreSQL read-only query output: all three `target_matches=true` |
| Browser console | PASS — no console errors in the main upload/activate/team/disable flow | CDP console capture |

## Defect fixed during E2E

The first live upload returned HTTP 500 because upload audit used the `sha256:...` string as `audit_events.target_id`, whose database type is UUID. Upload IDs are now stable UUIDs derived from the actor and idempotency key, so retries retain the same mutation hash and the audit target matches the catalog row. Focused API tests and the live upload/replay flow passed after the fix.

## Remaining verification note

After enabling the isolated PostgreSQL, Redis and SeaweedFS services, the full API suite passed **734/734**; web passed **484/484**; worker test-run suite passed **23/23**. API/web/worker typechecks and API/web/worker production builds passed. A full service-less API run had previously shown 577 passed and 157 skipped because integration suites are gated on service environment variables. This report records local test evidence only; it is not a deployment or checkpoint approval.
