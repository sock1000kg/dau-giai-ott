# Finals API v1

> **Status:** Implemented by `P3-D08` on top of the LOCKED [Finals Format v1](finals-format-v1.md) and
> [Finals ResultBundle v1](finals-result-bundle-v1.md) contracts.
> **Owner:** Phạm Tất Đạt (`P3-D*`). The deterministic finals domain (seeding/bracket/scoring) is owned
> by Long Trần (`P3-L06`) and is consumed here, not re-implemented.

## Scope

BTC-only control plane for one finals competition per tournament stage: versioned finals rule sets, the
locked eight-team seeding, the LAN submission window, cutoff pinning and per-team submission pins.
Persistence lives in [`0016_finals.sql`](../../src/platform/api/migrations/0016_finals.sql).

## Authorisation

Every route below is under `/api/v1/admin/finals/*` and requires a `BTC_ADMIN` session
(`requireRole(requireAuthenticated(request.principal), 'BTC_ADMIN')`). A team account receives
`403 FORBIDDEN`; an anonymous caller receives `401 UNAUTHENTICATED`; admin ingress is additionally
restricted by the admin network allowlist in `app.ts`.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/api/v1/admin/finals/rule-sets` | Create a new append-only finals rule set version |
| POST | `/api/v1/admin/finals/competitions` | Create the finals competition for a stage (`DRAFT_RULES`) |
| GET | `/api/v1/admin/finals/competitions/:competitionId` | Competition status, seeds and series |
| POST | `/api/v1/admin/finals/competitions/:competitionId/seed` | Lock the eight-team ranking |
| POST | `/api/v1/admin/finals/competitions/:competitionId/submission-window` | Open the LAN submission window |
| POST | `/api/v1/admin/finals/competitions/:competitionId/cutoff` | Close the cutoff and pin rule set + map pool |
| POST | `/api/v1/admin/finals/competitions/:competitionId/submission-pins` | Pin the submission a team runs |

### `POST /rule-sets`

Body: `{ tournamentStage, rules, reason }` → `201 { data: { id, version, rulesSha256, reason, createdAt } }`.
`rules` is `FinalsRuleSetRulesV1`: `schemaVersion: 1`, `engineVersion`, `maxTurns`, `perTurn`
(`FIXED`/`DYNAMIC`/`NONE`), `pairingWallClockMs`, non-empty unique `mapPool[]`,
`sidePolicy: 'SWAP_GAMES_1_2_SEEDED_GAME_3'`, `gameAdapter { adapterId, adapterVersion }`,
`bronzeMatchEnabled`. Versions increment per stage and are immutable (`finals_rule_sets` rejects
UPDATE/DELETE).

### `POST /competitions`

Body: `{ tournamentStage, ruleSetId, reason, bronzeMatchEnabled? }` → `201 { data: competition }`.
The rule set must belong to the same stage. `bronzeMatchEnabled` defaults to the rule set value
(Finals Format v1: configurable, default `true`).

### `POST /:competitionId/seed`

Body: `{ drawSeed, reason, minimumSeries? }`. The service reads the stage ranking from PostgreSQL
(finalized series only, latest ledger rating, ACTIVE submission), applies the published D-22
minimum-series rule through the `P3-L06` `seedFinals` domain, then writes eight append-only seed rows and
stores `draw_seed` + `seeding_hash` (AC-09: the locked ranking cannot be rewritten, and
`verifyLockedSeeding` re-derives the hash). Response: `{ seedingHash, seeds[], excluded[] }`.
`FINALS_SEED_COUNT_INVALID` is returned when the eligible count is not exactly eight.

### `POST /:competitionId/submission-window`

Body: `{ submissionOpensAt, lanCutoffAt, reason }` → moves `DRAFT_RULES → SUBMISSION_OPEN` and publishes
the cutoff. The cutoff must be after the opening time.

### `POST /:competitionId/cutoff`

Header: `Idempotency-Key` (1–200 chars). Body: `{ reason }`. The service closes the cutoff and pins the
current rule set plus its map pool, then moves `SUBMISSION_OPEN → SUBMISSION_CLOSED`. Retrying with the
same key **and** the same request hash replays the stored result (`replayed: true`); the same key with a
different request hash is refused with `409 IDEMPOTENCY_KEY_REUSED`, so a retry cannot silently change
what was pinned. The pin is immutable once set and later submission pins are frozen.

### `POST /:competitionId/submission-pins`

Body: `{ teamId, submissionId, source: 'LAN' | 'QUALIFICATION_ACTIVE', artifactSha256, compatible, reason }`.
The last LAN upload before the cutoff wins; the qualification `ACTIVE` fallback is accepted only when the
team has no LAN pin (`409 FINALS_PIN_CONFLICT`) and only when `compatible` is true. A pin that did not
pass preflight compatibility is refused by the `finals_submission_pins` trigger. After the cutoff every
pin is refused with `409 FINALS_CUTOFF_CLOSED`.

## Lifecycle and invariants (enforced in PostgreSQL)

`DRAFT_RULES → SUBMISSION_OPEN → SUBMISSION_CLOSED → RUNNING → SETTLING → RATED → PUBLISHED`

- Entering `RUNNING` (or later) requires **exactly eight seed rows**, a locked `seeding_hash`, a pinned
  rule set and a closed cutoff.
- `finals_seeds` is append-only with unique `(competition_id, ordinal 1..8)`; `draw_seed` and
  `seeding_hash` are immutable once set.
- `finals_series` may report a winner only in `FINALIZED`, and the winner must be one of the two seeds in
  the pairing (mirrors `resolveBracket` of `P3-L06`).
- `finals_series_games` must swap the home side between consecutive games; a `FINALIZED` game is immutable.
- Overrides carry a JSONB audit blob (reason, actor, time, evidence link) on
  `finals_series.override_audit`.

## Error codes

| HTTP | Codes |
| --- | --- |
| 400 | `INVALID_REASON`, `TOURNAMENT_STAGE_INVALID`, `FINALS_RULE_SET_INVALID` (with `details[]`), `FINALS_DRAW_SEED_INVALID`, `FINALS_WINDOW_INVALID`, `IDEMPOTENCY_KEY_INVALID`, `ARTIFACT_HASH_INVALID` |
| 401 / 403 | `UNAUTHENTICATED` / `FORBIDDEN` (shared auth plugin) |
| 404 | `FINALS_RULE_SET_NOT_FOUND`, `FINALS_COMPETITION_NOT_FOUND` |
| 409 | `FINALS_RULE_SET_STAGE_MISMATCH`, `FINALS_ALREADY_SEEDED`, `FINALS_STATUS_INVALID`, `FINALS_CUTOFF_CLOSED`, `FINALS_PIN_CONFLICT`, `FINALS_SEED_COUNT_INVALID`, `FINALS_CANDIDATE_DUPLICATE`, `FINALS_SEED_INVALID`, `IDEMPOTENCY_KEY_REUSED` |

## Migration numbering

`main` already shipped `0014_qualification_gate.sql` and `0015_test_runs.sql` (`P3-N06`), so this task
ships `0016_finals.sql`. `P3-D09` (ResultBundle) takes `0017`; the uncommitted L02 runtime-integration
migration must renumber to `0018` before it merges.

## Verification

- `npm run typecheck --workspace @ott/platform-api` — passes.
- `npm test --workspace @ott/platform-api -- tests/finals.integration.test.ts` — PostgreSQL integration
  for seeding/threshold/locking, cutoff idempotency, pin freezing and the trigger mutations (immutable
  seeds, incompatible LAN pin). The suite skips when `DATABASE_URL` is unset.
