# Spectator Replay API v1

**Status:** Accepted for Phase 2 local (`P2-T24`).

## BTC control plane

- `GET /api/v1/admin/replays/catalog?page=1&pageSize=25` requires a valid BTC session and lists eligible terminal matches. Rows may include match/team names, finalization time, publication state, and stored event-log checksum; they never include seed or storage key.
- `POST /api/v1/admin/replays/{matchId}/stage` and `/publish` require `BTC_ADMIN`, a JSON body `{ "reason": "..." }`, and a stable `Idempotency-Key` header. The API loads the key from PostgreSQL, reads the private object, recalculates SHA-256 over the exact stored bytes, parses event-log v1, and checks `matchId` and final-state hash before the repository transition.
- Repeating a request with the same key and same action/actor/match/reason returns the current publication record without a second audit event. Reusing the key for another intent returns `409 IDEMPOTENCY_KEY_REUSED`.
- The artifact is checked again before both `STAGE` and `PUBLISH`; object keys are never accepted from the caller.

## Public replay representation

`GET /api/v1/public/replays/{matchId}` is anonymous. It returns `404 REPLAY_NOT_FOUND` for missing, private, or staged matches, so publication state is not exposed. A published but unreadable or modified artifact returns `409 REPLAY_INTEGRITY_FAILED` without replay data.

The successful response uses media type `application/vnd.ott.spectator-replay+json` with exactly one `version=1` parameter. HTTP-equivalent formatting (parameter whitespace/quotes and a `charset` parameter added by the server framework) is valid; clients reject a missing, duplicate or unsupported version. Its UTF-8 body is a deterministic allowlisted projection with this top-level shape:

```json
{
  "schema": "ott.spectator-replay",
  "schemaVersion": 1,
  "matchId": "<uuid>",
  "header": {
    "format": "ott.match-event-log",
    "formatVersion": 1,
    "matchId": "<uuid>",
    "protocolVersion": 1,
    "engineVersion": "<version>",
    "game": { "engineVersion": "<version>", "maxTurns": 200, "map": "<allowlisted map definition>" }
  },
  "entries": [],
  "result": {},
  "faults": { "X": {}, "O": {} }
}
```

The private event-log `header.seed`, private object key, submission metadata, stderr, and unknown fields are not copied into the public representation. `X-Replay-SHA256` is the `sha256:<hex>` digest of the exact HTTP response body bytes (including its final newline), not the private source-object digest. Clients verify it against raw response bytes before parsing or using the representation. The source object's stored checksum remains private and is checked server-side before serving.

The body is `JSON.stringify(allowlistedRepresentation, null, 2)` followed by exactly one newline. The API sets `X-Content-Type-Options: nosniff` and permits shared caching only after the `PUBLISHED` gate.

## Errors

| Status | Code | Meaning |
| --- | --- | --- |
| 400 | `INVALID_PAGINATION`, `INVALID_TRANSITION` | Invalid bounded query/body/header |
| 401 | `UNAUTHENTICATED` | No valid session for a BTC operation |
| 403 | `FORBIDDEN` | A team account attempted a BTC operation |
| 404 | `REPLAY_NOT_FOUND` | Replay is not public or does not exist |
| 409 | `REPLAY_NOT_ELIGIBLE`, `REPLAY_STATE_CONFLICT`, `IDEMPOTENCY_KEY_REUSED` | Invalid transition state or reused intent key |
| 409 | `REPLAY_INTEGRITY_FAILED` | Stored object bytes or replay identity failed verification |
