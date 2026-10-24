# Team test-run API contract v1

The test-run portal lets an authenticated team validate an eligible submission against a configured BTC reference bot or another submission owned by the same team. Test runs do not enter the rating ledger. All endpoints require an authenticated `TEAM_ACCOUNT` or `BTC_ADMIN`; team accounts are scoped to their own team. A BTC administrator must supply `teamId` for policy/create operations.

## Policy

`GET /api/v1/test-run-policy[?roundId=<uuid>]` returns:

```json
{"data":{"roundId":"<uuid-or-null>","quota":{"limit":2,"consumed":0,"reserved":0,"remaining":2,"resetsAt":"<UTC ISO timestamp>"},"admissionPaused":false,"submissions":[{"id":"<uuid>","status":"ACTIVE","createdAt":"<ISO timestamp>"}],"opponents":{"referenceBots":[{"id":"btc-v1","displayName":"BTC baseline"}],"ownSubmissionAllowed":true},"maps":[{"mapId":"default","version":1,"checksum":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}]}}
```

An unpaused `SUBMISSION_OPEN` round supplies `quotaPerTeamPerDay`; when no rule exists, the limit is two. Later round states are past the test-run cutoff. `consumed` counts test runs whose worker claim started today (UTC); `reserved` counts queued runs admitted today. Both reduce `remaining`. The daily window resets at `resetsAt`. `admissionPaused` reflects a paused match queue, a paused round, or a round past the admission window.

## Create and list

`POST /api/v1/test-runs` accepts `Idempotency-Key` (8–200 characters) and JSON containing `submissionId`, `opponentType`, optional `opponentSubmissionId`, optional `opponentReferenceBot`, optional `roundId`, optional `mapId`, and optional `mapChecksum`. When choosing a map, both `mapId` and `mapChecksum` must be provided and must match an entry in the round's `mapSet` (or defaults to the first map). BTC administrators also provide `teamId`. New admissions tied to a round require `SUBMISSION_OPEN` before cutoff; closed, running, paused or finalized rounds reject admission. The response is `{ "data": <TestRun> }`. A replay of the same key and request returns the existing run; reusing a key with different content returns `409 IDEMPOTENCY_KEY_REUSED`. Queue admission reserves quota under a per-team transaction lock; the run and queue payload are stored atomically in `test_run_outbox`. The request publishes the pending outbox entry after commit; if enqueue fails, retry the same idempotency key to retry publication. BullMQ's stable match ID deduplicates the job. The worker consumes quota atomically when claiming the queued run. Test runs execute using Bot Protocol v2 with the round rule set's time control (`limits.timeControl` matching `round_rule_sets.rules.timeControl`). When round rules are missing or cannot be validated, the worker fails closed with refundable infra failure code `TEST_RUN_ROUND_RULES_UNAVAILABLE`. Infrastructure failures refund quota.

`GET /api/v1/test-runs?page=1&pageSize=20` returns `{ "data": [<TestRun>], "pagination": { "page": 1, "pageSize": 20, "totalItems": 0, "totalPages": 0 } }`. `page` is at least one and `pageSize` is from 1 to 100. Detail is `GET /api/v1/test-runs/:id` with `{ "data": <TestRun> }`.

The public `TestRun` DTO includes run identity, round/submission/opponent, status, quota-consumed state, result (including executed `mapId` and `mapChecksum`), bounded stderr, failure information and timestamps. It never exposes `teamId`, execution seed, object-storage key, replay artifact checksum or final-state integrity hash. All test-run endpoints reject roles other than `TEAM_ACCOUNT` and `BTC_ADMIN`.

## Opponent policy and errors

Eligible submissions have `ACTIVE` or `VALID` status. `OWN_SUBMISSION` can name any eligible submission owned by the same team, including the tested submission itself (`submissionId === opponentSubmissionId` for self-play). Self-play is allowed for test runs only (official tournament rounds strictly prohibit intra-team pairings). `BTC_REFERENCE` must name an enabled row from `test_run_reference_bots`. Deployments/demo setups populate that catalog with artifact object key, digests, entrypoint, and policy version. A missing or disabled bot is unavailable, and worker resolution fails closed.

The local `seed-demo` command automatically seeds the default BTC reference bot `btc-baseline` (`display_name: 'BTC baseline'`) from the pre-built demo bot archive mounted at `/seed/ott-demo-bot-go-v1.oci.tar`. The seeder (`seedDemoReferenceBot`) enforces `OTT_DEMO_MODE=true` and `OTT_DEPLOYMENT_MODE=dev|test`, validates the archive using `validateOciSubmission`, verifies its pinned SHA-256 (`80d1dd7d9fb46f3c2a4779f0a62cc7ee0d6a3ce4b741df026adbb7bf6109b4e6`), uploads it to object storage at `reference-bots/<sha256>.oci.tar` if absent, and upserts `test_run_reference_bots`. Re-running `seed-demo` or `demo.sh refresh` is idempotent and preserves the `enabled` flag if disabled by BTC admin.

Errors use `{ "error": { "code": "...", "message": "..." } }`. Relevant codes include `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `TEST_RUN_NOT_FOUND` (404), `TEST_RUN_QUOTA_EXCEEDED` (429 with `Retry-After`), `IDEMPOTENCY_KEY_REUSED` (409), `TEST_RUN_ADMISSION_PAUSED` (503), `REFERENCE_BOT_UNAVAILABLE` (422 at admission), `MAP_NOT_IN_ROUND` (422), `MAP_UNKNOWN` (test run failure), `TEST_RUN_ROUND_RULES_UNAVAILABLE` (infra failure), and `BAD_PAGINATION` (400).

## Private replay

`GET /api/v1/test-runs/:id/replay` is private and owner/admin scoped. It returns the verified spectator replay JSON as the raw response body with `Content-Type: application/vnd.ott.spectator-replay+json;version=1|2`, `X-Replay-Sha256` (SHA-256 of the projected response bytes), `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. The API checks stored raw artifact checksum, parsed match identity, and final-state hash before projecting it. Integrity failures return `409 REPLAY_INTEGRITY_FAILED`.
