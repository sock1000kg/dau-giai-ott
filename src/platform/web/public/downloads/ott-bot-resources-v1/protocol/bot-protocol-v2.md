# Bot Protocol v2 — approved design contract

> **Status:** APPROVED for Phase 3 implementation. Machine schema, types and fixtures are delivered by `P3-L01`:
> [`bot-protocol-v2.schema.json`](bot-protocol-v2.schema.json),
> [`fixtures/bot-protocol-v2-valid.ndjson`](fixtures/bot-protocol-v2-valid.ndjson) and
> [`fixtures/bot-protocol-v2-invalid-cases.json`](fixtures/bot-protocol-v2-invalid-cases.json).
>
> **Compatibility:** v1 remains immutable for Phase 1–2 regression. A match pins exactly one protocol version.

## Scope

V2 keeps STDIO/UTF-8/NDJSON and the five-message lifecycle of v1. It adds time-budget semantics and replaces
the real match seed with a bot-specific deterministic seed. All objects remain strict; the machine schema
must use `additionalProperties: false`.

## INIT changes

```ts
type TimeControlV2 = {
  startupMs: number;              // spawn → INIT written; replaces v1 startupTimeoutMs
  totalBotBudgetMs: number;       // chess clock for this bot in this game
  matchWallClockMs: number;       // hard cap for the whole match
  perTurn:
    | { mode: "FIXED"; fixedMs: number }
    | { mode: "DYNAMIC"; baseMs: number; stepMs: number; everyTurns: number; maxMs: number }
    | { mode: "NONE" };
};

// v1 Limits minus startupTimeoutMs/turnTimeoutMs, which timeControl supersedes.
type LimitsV2 = {
  maxTurns: number;
  maxMessageBytes: number;
  maxStderrBytes: number;
  maxConsecutiveFaults: number;
  maxTotalFaults: number;
  timeControl: TimeControlV2;
};

type InitMessageV2 = {
  type: "INIT";
  protocolVersion: 2;
  matchId: string;        // opaque; no team/opponent identity
  engineVersion: string;
  side: "X" | "O";
  botSeed: string;        // never engineSeed; unique to this bot/context
  map: MapDefinition;
  limits: LimitsV2;       // JSON Schema cannot intersect: timeControl is a required field of limits
};
```

`startupMs` sits inside `timeControl` rather than in `limits` so the wire shape matches the already-merged
`RoundRuleSetRulesV1.timeControl` (`P3-D01`) field for field: `startupMs`, `totalBotBudgetMs`,
`matchWallClockMs`, `perTurn`. JSON Schema draft 2020-12 cannot compare two properties, so the numeric
relations `baseMs <= maxMs <= totalBotBudgetMs` are enforced as semantic checks in `@ott/bot-protocol`
(`validateTimeControlV2`) instead of in the schema.


`botSeed` is derived server-side with HMAC from a secret not present in the job/replay exposed to another
team. The HMAC context binds at least tournament/match/game/team/protocol version. Replaying a private match
may restore the stored bot seed for that bot; consumers must never derive or expose the opponent/engine seed.

## STATE_UPDATE changes

```ts
type TurnBudgetV2 = {
  turnLimitMs: number | null;
  remainingBotBudgetMs: number;
};

type StateUpdateMessageV2 = StateUpdateV1Shape & {
  protocolVersion: 2;
  timeBudget: TurnBudgetV2;
};
```

`turnLimitMs = null` only means no per-turn cap; total bot budget and match wall-clock remain finite. The
runner computes all duration from a monotonic server clock. Bot timestamps are ignored.

## Approved defaults

- Qualification: startup 5.000 ms; total 60.000 ms/bot/game; Dynamic 1.000 ms plus 500 ms every 40 turns,
  capped at 3.000 ms; match wall-clock 150.000 ms.
- `30s`, `1min` and per-turn `NONE` are allowed only for test run/finals rule sets.
- Values are data in a locked `RoundRuleSet`/`FinalsRuleSet`, not protocol constants.

## Failure and compatibility rules

- Budget exhaustion maps to the approved timeout/forfeit policy and is recorded in the event log.
- A v1 validator must reject v2 and vice versa; no silent downgrade.
- Replay records protocol/rule version, budget decisions and remaining totals needed for verification.

## Machine contract (P3-L01)

| Artefact | Path |
| --- | --- |
| Design contract (this file) | `docs/contracts/bot-protocol-v2.md` |
| Machine schema | `docs/contracts/bot-protocol-v2.schema.json` |
| Valid transcript fixture | `docs/contracts/fixtures/bot-protocol-v2-valid.ndjson` |
| Invalid-case fixture | `docs/contracts/fixtures/bot-protocol-v2-invalid-cases.json` |
| Types and runtime validator | `src/bot-protocol/src/messages.ts`, `src/bot-protocol/src/validate.ts` |
| Contract tests | `src/bot-protocol/tests/schema-v2.test.ts` |

The v2 schema is self-contained: it repeats the shared `$defs` of v1 verbatim instead of `$ref`-ing across files,
and the contract test asserts the shared definitions stay deep-equal to v1 so the two versions cannot drift.
`TURN_RESULT` and `MATCH_RESULT` keep the v1 shape and only change `protocolVersion` to `2`; timing decisions are
added to the event log/replay by `P3-L02`, not to these two messages.

## Negotiation and compatibility

- A match pins exactly one protocol version. The Runner compiles exactly one schema with
  `compileProtocolValidator(schema)` and uses the matching entry point: `validateBotMessage` for v1,
  `validateBotMessageV2` for v2.
- Both directions fail closed: a v2 validator rejects every v1 message with `SCHEMA_VIOLATION` and a v1 validator
  rejects every v2 message the same way. `validateBotMessageV2` also returns `SCHEMA_VIOLATION` if it is handed a
  validator compiled from the v1 schema, so a wiring mistake cannot silently downgrade a match.
- There is no bot-side negotiation handshake: a bot never announces a version. If a bot answers a v2 `INIT` with
  `protocolVersion: 1`, that message is a `SCHEMA_VIOLATION` and the normal recoverable-fault policy applies
  (skip turn, then the v1 fault limits).
- `INIT` is the only message carrying the budget envelope; every later turn repeats `timeBudget` so a bot never
  has to remember rule-set values across restarts.
- Qualification-only bans (`FIXED 30s`, `FIXED 1min`, per-turn `NONE`) stay owned by the `RoundRuleSet` validator
  (`P3-D01`). This protocol module validates transport shape and the numeric budget relations only, keeping a
  single source for rule policy.

## Validation error codes (v2)

| Code | Emitted when |
| --- | --- |
| `MESSAGE_TOO_LARGE` | UTF-8 byte length (excluding the trailing LF) exceeds `maxMessageBytes` |
| `MALFORMED_JSON` | The line is not valid JSON |
| `SCHEMA_VIOLATION` | The message does not match the v2 schema, or the entry point received another version |
| `MATCH_ID_MISMATCH`, `TURN_ID_MISMATCH`, `ILLEGAL_ACTION` | `ACTION` semantic checks, unchanged from v1 |
| `INVALID_MODE` | `limits.timeControl.perTurn.mode` is not `FIXED`, `DYNAMIC` or `NONE` |
| `INVALID_BUDGET` | A `DYNAMIC` policy is missing a finite `baseMs`, `maxMs` or `totalBotBudgetMs` |
| `BASE_EXCEEDS_MAX` | `baseMs > maxMs` |
| `MAX_EXCEEDS_TOTAL_BUDGET` | `maxMs > totalBotBudgetMs` |


## Runtime timing and event-log fields (P3-L02)

`runMatch` pins v2 through `MatchConfig.protocolV2 = { timeControl, botSeeds }` and an injected monotonic
`ports.clock`; without it a match is unchanged v1. The policy is the pure module
`src/match-runner/src/timing-policy.ts`. Semantics the contract leaves open are fixed there:

- Turn index = Engine `turnNumber - 1` (both sides count); `DYNAMIC` limit = `min(maxMs, baseMs + stepMs * floor(index / everyTurns))`.
- Enforced deadline = strictest of per-turn limit, the bot's remaining budget and remaining match wall-clock.
  `timeBudget.turnLimitMs` is `min(perTurn, remaining budget)` (`null` for `NONE`); wall-clock is not folded into it.
- Answer on time ⇔ `elapsed <= deadline`; a late answer or transport `BOT_TIMEOUT` is charged `max(elapsed, deadline)` and
  the ACTION is discarded. Deadline 0 ⇒ the bot is not asked.
- Overrun of the per-turn limit = the existing recoverable `BOT_TIMEOUT` skip. Overrun of the bot budget or wall-clock =
  `BOT_TIMEOUT` skip, its TURN_RESULT, then a forfeit of that side with fault `BOT_TIMEOUT`. A process fault still wins.

Event log `formatVersion: 2` (v1 logs are unchanged and verify as before) has `header.protocolVersion: 2`,
`header.limits.timeControl` and a top-level `timing` array, one decision per bot-asked turn:
`turnId, side, turnLimitMs, deadlineMs, remainingBeforeMs, wallElapsedBeforeMs, elapsedMs, timedOut, chargedMs,
remainingAfterMs, exhaustion (null | TURN_LIMIT | BOT_BUDGET | WALL_CLOCK)`. `verifyReplay` recomputes every derived field from the
header rules plus the recorded `elapsedMs`/`timedOut`/`wallElapsedBeforeMs` and rejects a disagreement with
`TIMING_MISMATCH` (`timing[i] <field> is <recorded> but the rules give <expected>`). `parseAnyEventLog` reads both versions;
`parseEventLog` stays v1-only and rejects v2.

### Hosted execution snapshot and rule identity

Qualification `START` passes its internal `qualificationRoundId` into scheduling. The scheduler validates the locked
rule-set checksum, pins `timeControl`, engine/max-turn values and a `rule_set_id` in each match, and derives separate
HMAC-SHA256 bot seeds using an ephemeral server-only key and the context `[stage, matchId, gameNumber, teamId, 2]`.
The database stores derived seeds in `matches.protocol_v2`; neither the key nor the bot seeds enter queue payloads.
Retries read the same immutable snapshot. Migration `0018_match_protocol_v2` keeps existing matches at v1 and
rejects changes to either new snapshot field. Earlier numbers are taken on `main`: `0014` qualification gate,
`0015` test runs (`P3-N06`), `0016` finals (`P3-D08`) and `0017` result bundles (`P3-D09`).

Hosted v2 logs add optional `header.ruleSet = { id, version, sha256 }`, referring to the immutable rule set.
Historical v2 logs without this field continue to parse. Invalid supplied identities fail parsing. The worker
checks both v2 INIT shapes before acquiring a lease, uses the exported `monotonicClock` (`performance.now`) and
sets a lease long enough for the pinned finite wall-clock/startup cap plus finalization allowance.

`BotProcess` and `SandboxOciBotPort` select/check exactly the INIT protocol version and reject downgrade ACTIONs.
The sandbox preserves v2 INIT without inserting v1 timeout fields, enforces v2 startup, removes late-started
containers after a startup timeout, and uses the runner's effective v2 deadline without a second fixed 3s clamp.
V1 sandbox limits keep their existing clamp. Archive loading precedes the bot startup window.

The current map registry contains only `DEFAULT_MAP`. A hosted rule set naming another map or a map pool is
rejected with `ROUND_MAP_UNAVAILABLE` before scheduling; it never silently runs on the default map.
