# Spectator Replay API v2

**Status:** Approved policy for Phase 3 (P3-D05), extends v1.

> **Note:** Matches with event-log formatVersion 1 continue to be served as v1 representation (`version=1`). Matches with event-log formatVersion 2 (Bot Protocol v2) are served as v2 representation (`version=2`). See [Spectator Replay API v1](spectator-replay-v1.md) for v1 specification.

## Authorization Model

A match's stage = `series.tournament_stage` of its series.

- **Public replay** (`GET /api/v1/public/replays/:matchId`): Allowed **only** when stage = `FINALS` **and** publication state = `PUBLISHED`.
- **Private replay** (`GET /api/v1/replays/:matchId`): Allowed for:
  - `BTC_ADMIN` (any stage, any publication state including `PRIVATE`)
  - `TEAM_ACCOUNT` whose team owns the match's X or O submission (`matches.x_submission_id` / `o_submission_id` → `submissions.team_id`)
- Everyone else → **404 `REPLAY_NOT_FOUND`** (existence not leaked); anonymous → **401 `UNAUTHENTICATED`**.

## Endpoints

### `GET /api/v1/public/replays/:matchId` (anonymous)

| Stage | Publication State | Response |
|-------|-------------------|----------|
| FINALS | PUBLISHED | 200 + spectator replay artifact (v1 or v2 based on source match) |
| FINALS | STAGED / PRIVATE | 404 `REPLAY_NOT_FOUND` |
| QUALIFICATION / other | any | 404 `REPLAY_NOT_FOUND` |

Response headers (200):
- `Content-Type: application/vnd.ott.spectator-replay+json;version=1` (for v1 sources) or `application/vnd.ott.spectator-replay+json;version=2` (for v2 sources)
- `X-Replay-SHA256: sha256:<hex>` (digest of exact response body bytes including newline)
- `Cache-Control: public, max-age=3600, immutable`
- `X-Content-Type-Options: nosniff`

### `GET /api/v1/replays/:matchId` (authenticated session required)

| Actor | Stage | Publication State | Response |
|-------|-------|-------------------|----------|
| BTC_ADMIN | any | any (PRIVATE/STAGED/PUBLISHED) | 200 + spectator replay artifact (v1 or v2 based on source match) |
| Team X / Team O (match participants) | any | any | 200 + spectator replay artifact (v1 or v2 based on source match) |
| Third team / other TEAM_ACCOUNT | any | any | 404 `REPLAY_NOT_FOUND` |
| Anonymous | any | any | 401 `UNAUTHENTICATED` |

Response headers (200):
- `Content-Type: application/vnd.ott.spectator-replay+json;version=1` (for v1 sources) or `application/vnd.ott.spectator-replay+json;version=2` (for v2 sources)
- `X-Replay-SHA256: sha256:<hex>` (digest of exact response body bytes including newline)
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`

### `POST /api/v1/admin/replays/:matchId/stage` and `/publish` (BTC_ADMIN only)

| Stage | Action | Response |
|-------|--------|----------|
| FINALS | STAGE / PUBLISH | 200 (normal flow) |
| QUALIFICATION / other | STAGE / PUBLISH | 409 `REPLAY_NOT_PUBLIC_STAGE` |

The DB trigger (migration 0011) provides defense-in-depth: direct SQL `UPDATE replay_publications SET state='STAGED'` on a non-FINALS row is rejected.

## Replay Representation v2

When the source event log has `formatVersion: 2` (Bot Protocol v2), the replay representation uses `schemaVersion: 2`.

```json
{
  "schema": "ott.spectator-replay",
  "schemaVersion": 2,
  "matchId": "<uuid>",
  "header": {
    "format": "ott.match-event-log",
    "formatVersion": 2,
    "matchId": "<uuid>",
    "protocolVersion": 2,
    "engineVersion": "1.0.0",
    "game": {
      "engineVersion": "1.0.0",
      "maxTurns": 200,
      "map": { "..." : "allowlisted map definition" }
    },
    "limits": {
      "timeControl": {
        "startupMs": 2000,
        "totalBotBudgetMs": 30000,
        "matchWallClockMs": 60000,
        "perTurn": {
          "mode": "FIXED",
          "fixedMs": 1000
        }
      }
    }
  },
  "entries": [],
  "timing": [
    {
      "turnId": 1,
      "side": "X",
      "turnLimitMs": 1000,
      "deadlineMs": 1000,
      "remainingBeforeMs": 30000,
      "wallElapsedBeforeMs": 0,
      "elapsedMs": 120,
      "timedOut": false,
      "chargedMs": 120,
      "remainingAfterMs": 29880,
      "exhaustion": null
    }
  ],
  "result": {},
  "faults": { "X": {}, "O": {} }
}
```

### Truthful Header Versions & Limits

- `header.formatVersion`: `2` (truthful reflection of the source event-log format).
- `header.protocolVersion`: `2` (truthful reflection of the bot protocol used in the match).
- `header.engineVersion`: exported `ENGINE_VERSION` from `@ott/game-core` (currently `"1.0.0"`).
- `header.limits.timeControl`: allowlisted projection of the match's time control configuration (`startupMs`, `totalBotBudgetMs`, `matchWallClockMs`, and `perTurn` policy). Private container resource limits (memory, CPU shares, pids) are stripped.

### Timing Array Schema

`timing` is an array of `TimingDecision` elements, allowlisting public timing details:
- `turnId`: 1-based turn number.
- `side`: `'X'` | `'O'`.
- `turnLimitMs`: per-turn timeout in milliseconds, or `null`.
- `deadlineMs`: calculated turn deadline from turn start.
- `remainingBeforeMs`: bot bank time remaining prior to turn execution.
- `wallElapsedBeforeMs`: wall-clock elapsed time prior to turn execution.
- `elapsedMs`: bot execution duration for this turn.
- `timedOut`: boolean indicator if bot exceeded time limit.
- `chargedMs`: milliseconds charged to the bot's bank budget.
- `remainingAfterMs`: bot bank time remaining after turn execution.
- `exhaustion`: `'TURN_LIMIT'` | `'BOT_BUDGET'` | `'WALL_CLOCK'` | `null`.

Internal execution fields, process diagnostics, and system timestamps are omitted.

### Deterministic Serialization & Integrity

The response body is serialized deterministically via canonical JSON (`JSON.stringify(..., null, 2)`) with a single trailing newline (`\n`).
`X-Replay-SHA256` header contains `sha256:<hex>` computed over the exact UTF-8 body bytes sent over HTTP.
Clients MUST verify the checksum against raw response bytes before parsing or deserializing the replay.

## Authorization Matrix

| Actor \ Match | QUALIFICATION PRIVATE | FINALS PRIVATE | FINALS STAGED | FINALS PUBLISHED |
|---------------|----------------------|----------------|---------------|------------------|
| Anonymous | private: 401 / public: 404 | private: 401 / public: 404 | private: 401 / public: 404 | private: 401 / public: 200 |
| Team X (participant) | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |
| Team O (participant) | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |
| Third team | private: 404 / public: 404 | private: 404 / public: 404 | private: 404 / public: 404 | private: 404 / public: 200 |
| BTC_ADMIN | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |

## Error Codes

| Status | Code | Meaning |
|--------|------|---------|
| 400 | `INVALID_PAGINATION`, `INVALID_TRANSITION` | Invalid bounded query/body/header |
| 401 | `UNAUTHENTICATED` | No valid session for private replay read or BTC operation |
| 403 | `FORBIDDEN` | A team account attempted a BTC operation |
| 404 | `REPLAY_NOT_FOUND` | Replay is not public, does not exist, or caller is not authorized |
| 409 | `REPLAY_NOT_PUBLIC_STAGE` | Stage/Publish attempted on non-FINALS match |
| 409 | `REPLAY_NOT_ELIGIBLE`, `REPLAY_STATE_CONFLICT`, `IDEMPOTENCY_KEY_REUSED` | Invalid transition state or reused intent key |
| 409 | `REPLAY_INTEGRITY_FAILED` | Stored object bytes or replay identity failed verification |

## Cache Behavior

- Public endpoint: `public, max-age=3600, immutable` (shared caching after `PUBLISHED` gate)
- Private endpoint: `private, no-store` (no shared caching, per-session only)

## Integrity

Both endpoints reuse the same server-side integrity check (`loadVerifiedReplay`):
- Object bytes loaded from storage, SHA-256 verified against stored checksum in PostgreSQL.
- Event log parsed using `parseAnyEventLog` supporting both formatVersion 1 and formatVersion 2.
- `matchId` and `finalStateHash` cross-checked against database records.
- Tampered object → `409 REPLAY_INTEGRITY_FAILED` on both public and private reads.

Seed, object key, submission metadata, and stderr are never exposed in either representation.

## Player compatibility (P3-L04)

The player accepts representation v1 with event-log format 1, protocol 1 and
engine `1.0.0`, as well as representation v2 with event-log format 2, protocol 2 and
engine `1.0.0`. Both the public v1 endpoint and the authenticated v2 API use these
representations based on the source match. Clients MUST reject an unknown `schemaVersion`, and a media-type `version` that does not match the body's `schemaVersion`, with `UNSUPPORTED_SCHEMA`. Unsupported engine/protocol/format versions are rejected
before rendering, after verification of the response SHA-256 checksum.

The spectator web player supports both `schemaVersion: 1` and `schemaVersion: 2`:
- Media type version parameter must match body `schemaVersion`:
  - `application/vnd.ott.spectator-replay+json;version=1` matches `schemaVersion: 1`.
  - `application/vnd.ott.spectator-replay+json;version=2` matches `schemaVersion: 2`.
- Historical engine and protocol versions are allowlisted via `supportsHistoricalReplay`:
  - `(engineVersion: "1.0.0", protocolVersion: 1, formatVersion: 1)`
  - `(engineVersion: "1.0.0", protocolVersion: 2, formatVersion: 2)`
  Any other tuple is rejected with `UNSUPPORTED_SCHEMA`.
- When rendering `schemaVersion: 2`, elapsed time and remaining budget are surfaced in the active event card.

Board frames are reconstructed from recorded events and the recorded map; the
player does not invoke current game rules. Each move-list button seeks to the
last event of its entry, including any terminal event. The active move follows
the playback slider. Buttons support Tab, Enter/Space, Arrow Up/Down, Home and End,
and expose the current move with `aria-current="step"`.
