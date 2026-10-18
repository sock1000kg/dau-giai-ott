# P3-L02 runtime integration — 2026-10-18

Branch: `longt/feat-p3-l02-runtime-integration`, branched from `main` at `80e4078` (merge of PR #34,
`P3-L02` chess-clock) and rebased onto the current `main` before pushing. Implementation is committed on
this branch, not merged and not deployed.

## Behavior

- Closed qualification rounds pin immutable rule-set identity, time control and separate HMAC-derived bot seeds.
- Existing match rows and queue payloads remain v1-compatible; queue payloads contain neither private seed.
- BotProcess/sandbox transport preserve v2 messages, reject downgrade and enforce startup/turn timing.
- Workers inject `performance.now`, validate the stored snapshot before claiming a lease and finalize v1/v2 logs.
- Hosted v2 logs include the rule-set identity; historical v2 logs without it still parse.
- The current map registry is the default map only; unavailable maps fail before scheduling.

## Verification

Runtime: Node.js 22.23.3. Database: an isolated PostgreSQL 18 cluster on loopback port 25433,
with dedicated schemas per new integration test. No existing database or container was modified.

| Check | Result |
| --- | --- |
| MatchRunner `timing bot-process-v2` | 49 passed |
| Worker `timing-worker sandbox-v2 finalization.integration fault-persistence` | 14 passed |
| API `scheduling.integration timing-snapshot round-rules.start` | 6 passed |
| API `round-rules.integration` | 20 passed |
| Bot protocol full suite | 55 passed |
| Game core full suite | 46 passed |
| Root typecheck/build | passed |
| Full MatchRunner | 183 passed, 9 failed on this Windows host |
| Full API without integration environment | 242 passed, 88 skipped, 1 failed |

The two lifecycle failures (`close-stdout`, SIGTERM/SIGKILL duration) were reproduced on the original
`main` BotProcess. Seven Python E2E failures report spawn failure (`python3` is not installed on this host);
the baseline task already records that platform limitation. The API failure is the existing registry test
comparing a Windows path with a literal POSIX slash; migration execution itself passed in PostgreSQL.
No tests were skipped, assertions removed or thresholds reduced to hide these failures.

The existing finalization fixture now uses its own schema, since deleting finalized match rows conflicts
with the immutable replay-publication history. All five existing assertions now pass together with teardown.
The round fixture uses the actual default-map identity rather than an unavailable placeholder map.

## Negative evidence

- The snapshot integration test fails against the original scheduler because `rule_set_id` is null.
- Transport tests fail on the original sandbox: it inserts v1 timeout fields and accepts v1 ACTION in v2.
- Startup timeout test fails without deadline enforcement and checks late-container kill/removal.
- A changed timing charge is rejected with `TIMING_MISMATCH`.
- A corrupt stored snapshot is rejected before any attempt lease is written.
- Rule-set metadata with zero version or invalid checksum fails parsing; historical v2 logs still verify.

## Graph and review

GitNexus was reindexed in the actual checkout. Structured `detect_changes(scope=all)` included new files:
25 files / 138 symbols / 33 affected processes; `partial=false`, `truncated=false`, risk **critical**.
The complete JSON was inspected from the local tool output. The graph's process discovery also reports
bounded coverage, so these process counts are not a proof that no other paths exist.
Pre-edit warnings included HIGH sandbox transport and event-log header risk. Callers reviewed include
preflight, official worker, CLI, replay parsing and finalization. Core/protocol contracts remain compatible.

Real Docker corpus qualification was not run: Docker Desktop returned API 500 while preparing a test image.
The sandbox test uses a Docker transport double; worker integration uses real Node bot processes.
Hosted capacity, sandbox corpus and checkpoint approval remain the responsible owners' release evidence.

DOCS UPDATED: Bot Protocol v2 contract, MatchRunner README, worker README, task breakdown and this report.

## Rebase re-verification (2026-10-18, `main` = `1a8b356`)

Rebased onto `main` after `P3-D08` (PR #41) and `P3-D09` (PR #42) merged. Conflicts were import/registry
only: `src/platform/api/src/db/schema.ts` keeps `0014`–`0017` from `main` and appends
`0018_match_protocol_v2` last, and `modules/scheduling/service.ts` keeps both the D01/L03 imports and the
`rounds/types.ts` import. Re-ran on the rebased base against an isolated PostgreSQL 18 cluster on loopback
port 25435 (temporary cluster, removed afterwards):

| Check | Result |
| --- | --- |
| Root `npm run typecheck` (all workspaces) | passed |
| MatchRunner `timing bot-process-v2` | 49 passed |
| Worker `sandbox-v2` | 6 passed |
| API `timing-snapshot round-rules scheduling` | 66 passed (unit/logic) + 22 passed across 3 integration files with PostgreSQL |
| Worker `timing-worker` (PostgreSQL, real Node bot processes) | 2 passed |

The Windows/Python host limitations recorded above are unchanged and were not hidden.

### Time-dependent fixture found on re-run (2026-10-18, after 12:00 UTC)

A later re-run of the same three integration files failed two assertions in `round-rules.integration.test.ts`
("close before grace period is rejected" and the cascading follow-up): the fixture pins
`schedule.graceEndsAt = 2026-10-18T12:00:00Z` while that test uses the real clock, and the sibling test right
after it already injects `{ now }`. The first successful re-run happened at 10:11 UTC (before the pinned
deadline) and the failing one at 13:23 UTC (after it), with no code change in between. The two commits that
landed on `main` after this branch's base touch only `deploy/lan/*`, `scripts/lan-smoke.sh` and
`tests/e2e/lan-recovery.test.ts`, so this is a pre-existing, time-dependent fixture on `main` (owned by
`P3-D01`), not a `P3-L02` regression. Proposed one-line fix: pass an explicit `{ now: () => new Date(...) }`
before `graceEndsAt`, as the neighbouring test does.
