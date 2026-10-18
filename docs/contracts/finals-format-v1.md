# Finals Format v1

> **Status:** LOCKED for Phase 3 planning; implementation is tracked by `P3-L06` and `P3-D08`.
> The pure domain of `P3-L06` is implemented in `src/platform/api/src/modules/finals/`; persistence,
> the `FinalsRuleSet` store and the LAN flow stay in `P3-D08`.

## Bracket

- Exactly 8 teams; no group stage.
- Single elimination: quarterfinal → semifinal → final.
- Quarterfinal pairs: `1–8`, `4–5`, `2–7`, `3–6`.
- `bronzeMatchEnabled` is configurable and defaults to `true`; when enabled, semifinal losers play for third.
- Every pairing is BO3 and advances only after its series is `FINALIZED`.

## Unique qualification seed

Order teams by: Elo → series wins → game-point differential → head-to-head when exactly two remain tied →
deterministic public draw using a committed/published draw seed. This yields a unique ordinal `1..8`.

## Game decision adapter

The platform pins `gameAdapterId` and `gameAdapterVersion`. For each game the adapter returns either a direct
winner or an ordered `scoreBreakdown` whose criterion ids, values and comparison direction are defined by
that adapter version. The platform stores/displays the breakdown but never recomputes game rules.

Decision order: direct winner → ordered adapter criteria → better qualification seed. A finals game therefore
has exactly one winner. For the current game, capture/position scores may be adapter criteria; they are not
universal platform fields.

## Time, side and map policy

- `FinalsRuleSet` pins `maxTurns`, per-turn policy, finite game/pairing wall-clock cap, map pool, side policy,
  adapter version and bronze setting before finals.
- PoC defaults: `maxTurns = 200`, pairing wall-clock cap `30 minutes`.
- Game 1/2 swap the current adapter's two sides (X/O for the current game). Game 3 side is selected
  deterministically from the committed series seed; generic UI renders adapter-provided side labels.
- A map does not repeat within a series until the locked pool is exhausted.

## Implementation notes (P3-L06)

The pure domain lives in `src/platform/api/src/modules/finals/` and is covered by
`src/platform/api/tests/finals-domain.test.ts`; no database is required to run it.

- `seeding.ts` — `seedFinals()` applies the tie-break chain above, reports teams below the D-22
  minimum-series threshold (`finalsEligibility` from `scheduling/eligibility.ts`) instead of ranking
  them, and refuses a bracket unless exactly eight teams remain. The result is frozen and carries
  `seedingHash` (SHA-256 over `ordinal:teamId:submissionId`); `verifyLockedSeeding()` re-derives it, so
  AC-09 ("seed đúng tie-break, không đổi sau khi khóa") is provable. A tie bucket holding exactly two
  teams uses their direct result; any larger bucket uses the committed `drawSeed` only.
- `scheduling.ts` — `createFinalsBracket()` builds `QF1..QF4` from the fixed pairs, then `SF1`, `SF2`,
  `F1` and (when enabled) `B1` between the semifinal losers. `planSeriesGames()` fixes games 1/2 as
  X→O then O→X, takes game 3's side from the committed series seed, and orders the locked map pool by a
  keyed hash of that seed so no map repeats before the pool is exhausted. `resolveBracket()` advances a
  pairing only from a `FINALIZED` series and rejects a winner that is not one of the two seeds.
  `applySeriesOverride()` requires reason, actor, time and evidence link.
- `scoring.ts` — `decideFinalsGame()` implements the decision order (direct adapter winner → ordered
  `scoreBreakdown` with per-criterion `HIGHER_WINS`/`LOWER_WINS` → better qualification seed), so a
  finals game always has exactly one winner (D-05). The adapter id/version must match the pinned rule
  set (`FINALS_ADAPTER_VERSION_MISMATCH`). `scoreFinalsSeries()` scores BO3 to the first side with two
  wins and refuses a third win or a fourth game.
- Inputs stay explicit: this module receives the qualification seed order, the committed seeds and the
  adapter result; it never reads the database, a clock or game rules.

Error codes: `FINALS_SEED_COUNT_INVALID`, `FINALS_SEED_INVALID`, `FINALS_CANDIDATE_DUPLICATE`,
`FINALS_CANDIDATE_INVALID`, `FINALS_DRAW_SEED_INVALID`, `FINALS_SERIES_SEED_INVALID`,
`FINALS_MAP_POOL_EMPTY`, `FINALS_MAP_POOL_DUPLICATE`, `FINALS_MAP_POOL_INVALID`,
`FINALS_BEST_OF_INVALID`, `FINALS_SERIES_EXTRA_GAME`, `FINALS_PAIRING_UNKNOWN`,
`FINALS_PAIRING_DUPLICATE`, `FINALS_SERIES_NOT_FINALIZED`, `FINALS_WINNER_INVALID`,
`FINALS_OVERRIDE_AUDIT_REQUIRED`, `FINALS_ADAPTER_VERSION_MISMATCH`, `FINALS_CRITERION_INVALID`,
`FINALS_CRITERION_DUPLICATE`.
