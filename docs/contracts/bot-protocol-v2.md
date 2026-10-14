# Bot Protocol v2 — approved design contract

> **Status:** APPROVED for Phase 3 implementation; machine schema/types/fixtures are delivered by `P3-L01`.
>
> **Compatibility:** v1 remains immutable for Phase 1–2 regression. A match pins exactly one protocol version.

## Scope

V2 keeps STDIO/UTF-8/NDJSON and the five-message lifecycle of v1. It adds time-budget semantics and replaces
the real match seed with a bot-specific deterministic seed. All objects remain strict; the machine schema
must use `additionalProperties: false`.

## INIT changes

```ts
type TimeControlV2 = {
  totalBotBudgetMs: number;
  matchWallClockMs: number;
  perTurn:
    | { mode: "FIXED"; fixedMs: number }
    | { mode: "DYNAMIC"; baseMs: number; stepMs: number; everyTurns: number; maxMs: number }
    | { mode: "NONE" };
};

type InitMessageV2 = {
  type: "INIT";
  protocolVersion: 2;
  matchId: string;        // opaque; no team/opponent identity
  engineVersion: string;
  side: "X" | "O";
  botSeed: string;        // never engineSeed; unique to this bot/context
  map: MapDefinition;
  limits: LimitsV2 & { timeControl: TimeControlV2 };
};
```

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
