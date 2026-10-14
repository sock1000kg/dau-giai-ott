# Finals Format v1

> **Status:** LOCKED for Phase 3 planning; implementation is tracked by `P3-L06` and `P3-D08`.

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
