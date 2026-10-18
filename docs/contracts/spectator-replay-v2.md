# Spectator Replay API v2

**Status:** Approved policy for Phase 3 (P3-D05), extends v1.

> **Note:** v1 representation remains unchanged. This document only adds authorization rules, a new private endpoint, and error codes. See [Spectator Replay API v1](spectator-replay-v1.md) for representation, headers, and base errors (superseded by v2 for authorization).

## Authorization Model

A match's stage = `series.tournament_stage` of its series.

- **Public replay** (`GET /api/v1/public/replays/:matchId`): Allowed **only** when stage = `FINALS` **and** publication state = `PUBLISHED`.
- **Private replay** (`GET /api/v1/replays/:matchId`): Allowed for:
  - `BTC_ADMIN` (any stage, any publication state including `PRIVATE`)
  - `TEAM_ACCOUNT` whose team owns the match's X or O submission (`matches.x_submission_id` / `o_submission_id` → `submissions.team_id`)
- Everyone else → **404 `REPLAY_NOT_FOUND`** (existence not leaked); anonymous → **401**.

## Endpoints

### `GET /api/v1/public/replays/:matchId` (anonymous)

| Stage | Publication State | Response |
|-------|-------------------|----------|
| FINALS | PUBLISHED | 200 + v1 artifact |
| FINALS | STAGED / PRIVATE | 404 `REPLAY_NOT_FOUND` |
| QUALIFICATION / other | any | 404 `REPLAY_NOT_FOUND` |

Response headers (200):
- `Content-Type: application/vnd.ott.spectator-replay+json;version=1`
- `X-Replay-SHA256: sha256:<hex>` (digest of response body bytes)
- `Cache-Control: public, max-age=3600, immutable`
- `X-Content-Type-Options: nosniff`

### `GET /api/v1/replays/:matchId` (authenticated session required)

| Actor | Stage | Publication State | Response |
|-------|-------|-------------------|----------|
| BTC_ADMIN | any | any (PRIVATE/STAGED/PUBLISHED) | 200 + v1 artifact |
| Team X / Team O (match participants) | any | any | 200 + v1 artifact |
| Third team / other TEAM_ACCOUNT | any | any | 404 `REPLAY_NOT_FOUND` |
| Anonymous | any | any | 401 `UNAUTHENTICATED` |

Response headers (200):
- `Content-Type: application/vnd.ott.spectator-replay+json;version=1`
- `X-Replay-SHA256: sha256:<hex>` (digest of response body bytes)
- `Cache-Control: private, no-store`
- `X-Content-Type-Options: nosniff`

Representation body: identical to v1 public artifact (deterministic projection, no seed, no object key).

### `POST /api/v1/admin/replays/:matchId/stage` and `/publish` (BTC_ADMIN only)

| Stage | Action | Response |
|-------|--------|----------|
| FINALS | STAGE / PUBLISH | 200 (normal flow) |
| QUALIFICATION / other | STAGE / PUBLISH | 409 `REPLAY_NOT_PUBLIC_STAGE` |

The DB trigger (migration 0011) provides defense-in-depth: direct SQL `UPDATE replay_publications SET state='STAGED'` on a non-FINALS row is rejected.

## Authorization Matrix

| Actor \ Match | QUALIFICATION PRIVATE | FINALS PRIVATE | FINALS STAGED | FINALS PUBLISHED |
|---------------|----------------------|----------------|---------------|------------------|
| Anonymous | private: 401 / public: 404 | private: 401 / public: 404 | private: 401 / public: 404 | private: 401 / public: 200 |
| Team X (participant) | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |
| Team O (participant) | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |
| Third team | private: 404 / public: 404 | private: 404 / public: 404 | private: 404 / public: 404 | private: 404 / public: 200 |
| BTC_ADMIN | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 404 | private: 200 / public: 200 |

## Error Codes (additions to v1)

| Status | Code | Meaning |
|--------|------|---------|
| 401 | `UNAUTHENTICATED` | No valid session for private replay read |
| 409 | `REPLAY_NOT_PUBLIC_STAGE` | Stage/Publish attempted on non-FINALS match |

## Cache Behavior

- Public endpoint: `public, max-age=3600, immutable` (shared caching after `PUBLISHED` gate)
- Private endpoint: `private, no-store` (no shared caching, per-session only)

## Integrity

Both endpoints reuse the same server-side integrity check (`loadVerifiedReplay`) as v1:
- Object bytes loaded from storage, SHA-256 verified against stored checksum
- Event log parsed, `matchId` and `finalStateHash` cross-checked
- Tampered object → `409 REPLAY_INTEGRITY_FAILED` on both public and private reads

Seed, object key, submission metadata, and stderr are never exposed in either representation.

## Player compatibility (P3-L04)

The player accepts representation v1 with event-log format 1, protocol 1 and
engine `1.0.0`. Both the public v1 endpoint and the authenticated v2 API use this
same representation. Unsupported engine/protocol/format versions are rejected
before rendering, after verification of the response SHA-256 checksum.

Board frames are reconstructed from recorded events and the recorded map; the
player does not invoke current game rules. Each move-list button seeks to the
last event of its entry, including any terminal event. The active move follows
the playback slider. Buttons support Tab, Enter/Space, Arrow Up/Down, Home and End,
and expose the current move with `aria-current="step"`.

Raw protocol/event-log v2 is not a supported spectator representation yet.
P3-L04 acceptance criterion 3 in `tasks/todo.md` requests historical v1/v2
fixtures, while this contract preserves representation v1. Support for raw v2
requires an approved representation contract; it is not silently interpreted as v1.
