# Finals ResultBundle v1

> **Status:** LOCKED cryptographic envelope. Machine implementation is delivered by `P3-D09` in
> `src/platform/api/src/modules/result-bundles/` with migration `0017_result_bundles.sql`.

## Trust model

- Offline finals owns the Ed25519 private signing key; it is never committed or copied to the hosted system.
- Hosted importer stores only an allowlisted public key identified by `keyId`.
- PoC may use a clearly labeled test key. HSM and automated rotation are outside scope.

## Manifest

The manifest is UTF-8 JSON canonicalized with RFC 8785 before Ed25519 signing. It contains at least:

```ts
type ResultBundleManifestV1 = {
  schemaVersion: 1;
  bundleId: string;
  bundleVersion: number;
  tournamentId: string;
  finalsRuleSetId: string;
  keyId: string;
  createdAt: string; // UTC RFC 3339
  correctionOf?: { bundleId: string; bundleVersion: number; reason: string };
  artifacts: Array<{
    path: string;
    mediaType: string;
    sha256: string;
    bytes: number;
  }>;
};
```

Artifacts include bracket/series/match results plus referenced event logs/replay payloads. Paths are normalized,
relative and unique; traversal, symlink and duplicate-path entries are rejected.

## Import

1. Parse strict schema and locate allowlisted `keyId`.
2. Recreate RFC 8785 canonical manifest and verify Ed25519 signature.
3. Verify presence, byte length and SHA-256 of every artifact; reject unlisted files according to importer policy.
4. Validate cross-references and persist/publish all-or-nothing in one idempotent transaction.

Re-import of the same `bundleId`/version/content succeeds without duplicate effects. A changed bundle needs a
higher version plus `correctionOf.reason` and append-only audit. One bad byte rejects the entire bundle.

## Public proof metadata

The hosted snapshot exposes `bundleId`, `bundleVersion`, `keyId`, canonical manifest SHA-256, import timestamp
and `VERIFIED`. It never exposes the private key, internal object key or unpublished replay.

## Implementation notes (P3-D09)

| Artefact | Path |
| --- | --- |
| Persistence | `src/platform/api/migrations/0017_result_bundles.sql` |
| Canonicalization | `src/platform/api/src/modules/result-bundles/canonical.ts` |
| Offline signing | `src/platform/api/src/modules/result-bundles/exporter.ts` |
| Hosted import | `src/platform/api/src/modules/result-bundles/importer.ts` |
| HTTP surface | `src/platform/api/src/modules/result-bundles/routes.ts` |
| Integration tests | `src/platform/api/tests/result-bundles.integration.test.ts` |

- **Canonicalization** implements RFC 8785 without adding a dependency: keys are sorted by UTF-16 code
  units and values are serialized with `JSON.stringify`, whose number formatting is the ECMAScript
  `Number::toString` that JCS requires. The importer re-derives the canonical text from the parsed
  manifest, so the caller's byte layout never decides the signature.
- **Keys** live in `result_bundle_keys` (`keyId`, `algorithm = Ed25519`, SPKI PEM, `revoked_at`). The
  importer only reads allowlisted, non-revoked keys; the private key exists solely on the offline side.
  `exporter.ts` is the library the LAN tooling uses; the hosted API imports only.
- **Verification order** (all before any write): strict manifest schema (unknown fields, `schemaVersion`,
  RFC 3339 `createdAt`, SHA-256 shape, path normalization rejecting absolute/traversal/duplicate paths)
  → canonical text → allowlisted key → Ed25519 signature → every declared artifact present with matching
  byte length and SHA-256 → no unlisted artifact.
- **All-or-nothing**: the bundle row is inserted as `IMPORTED`, artifacts are inserted, and only then the
  row moves to `VERIFIED` inside the same transaction. A `DEFERRABLE INITIALLY DEFERRED` constraint
  trigger checks at commit time that the number of stored artifacts equals the manifest's declared
  count, so a partial publication cannot be committed.
- **Idempotency**: re-importing the same `bundleId`/`bundleVersion` with the same manifest hash and
  signature returns the existing publication (`replayed: true`) without duplicate rows. Different content
  for the same version is refused (`RESULT_BUNDLE_VERSION_CONFLICT`): a correction needs a higher
  `bundleVersion` plus `correctionOf { bundleId, bundleVersion, reason }`, which the DB also validates
  (base version must exist, reason must be present, version must increase).
- **HTTP**: `POST /api/v1/admin/result-bundles` (BTC-only; body `{ manifest, signature, artifacts:
  [{ path, payloadBase64 }] }`; 201 new / 200 replayed) and
  `GET /api/v1/public/result-bundles/:bundleId` (anonymous; verified proof metadata per version only).
  Error mapping: 400 malformed manifest/correction/body, 422 key not allowlisted, signature invalid,
  artifact missing/tampered/unlisted, 409 version conflict.
- **Dependency note**: `P3-N07` (isolated LAN deployment) is still open, so verification uses a clearly
  labelled test key generated inside the integration test; production signing stays on the offline side.


## Artifact schemas v1 (P3-D28, PROPOSED)

**Status: PROPOSED — pending review by Long Trần (finals domain) and Đỗ Khôi Nguyên (offline exporter / LAN).**
The trust-model, manifest and import sections above are unchanged. This section defines what the artifacts
contain so that a later task (D29: importer validation + public read endpoint) and the public finals UI
(P3-D10) can read them. Machine schema: [`finals-result-bundle-artifacts-v1.schema.json`](finals-result-bundle-artifacts-v1.schema.json)
(JSON Schema 2020-12, `$defs` per artifact, `additionalProperties: false`). Code: `src/platform/api/src/modules/result-bundles/artifacts.ts`
(pure; not yet called by the importer).

### Artifact set and paths

Only these four path patterns exist (`<id>` matches `^[A-Za-z0-9_-]{1,64}$`); anything else is
`ARTIFACT_PATH_UNSUPPORTED`. Every JSON artifact is UTF-8, carries `"schema": "ott.finals.<name>"` and
`"schemaVersion": 1`, and has no properties beyond those listed.

| Path | `schema` | Media type | Max size |
| --- | --- | --- | --- |
| `bracket.json` (exactly one) | `ott.finals.bracket` | `application/json` | 256 KiB |
| `series/<pairingId>.json` | `ott.finals.series` | `application/json` | 256 KiB |
| `matches/<matchId>.json` | `ott.finals.match` | `application/json` | 256 KiB |
| `replays/<matchId>.json` (optional per match) | `ott.spectator-replay` | `application/vnd.ott.spectator-replay+json;version=1` | 2 MiB |

The builder writes canonical (RFC 8785) JSON so the same input always yields the same bytes.

### `bracket.json`

| Field | Meaning |
| --- | --- |
| `tournamentId`, `finalsRuleSetId` | Same values as the manifest. |
| `bronzeMatchEnabled` | Whether a `BRONZE` pairing exists. |
| `seedingHash` | SHA-256 of the locked ordinals (`seedingHashOf`). |
| `drawSeedCommitment` | SHA-256 hex of the committed draw seed. **The seed itself is never published.** |
| `seeds[8]` | `{ seed, teamName, qualificationRank, rating }`, ordered 1..8, `qualificationRank == seed`. No team ids, submission ids or e-mails. |
| `pairings[]` | `FinalsPairing`: `{ id, round, slot, home, away }`; a slot is `{kind:'SEED',seed}` or `{kind:'WINNER'|'LOSER',pairingId}`. Must equal `createFinalsBracket` for the same seeds and bronze flag. |
| `resolved[]` | Same order as `pairings`: `{ id, round, state: 'PENDING'\|'FINALIZED', homeSeed, awaySeed, winnerSeed, loserSeed }` (seeds `null` until known). |

### `series/<pairingId>.json`

`{ pairingId, round, bestOf: 3, state: 'PENDING'|'FINALIZED', games[], outcome }`.
`games[]` (≤ 3, numbered from 1) = `{ game, homeSide, awaySide, mapId, matchId|null, state: 'SCHEDULED'|'FINALIZED'|'CANCELLED' }`;
`matchId` is non-null exactly when `state` is `FINALIZED`. `outcome` = `{ winnerSeed, loserSeed, homeGameWins,
awayGameWins, decisionBasis }`; `decisionBasis` (`DIRECT`, `CRITERION`, `QUALIFICATION_SEED`) is the basis of the
game that clinched the series and is `null` while pending. The series seed is **not** published, so the validator
checks the game list shape only: games 1..n, game 1 home side `X`, game 2 home side `O`, away side opposite to home
side, `mapId` unique within the series.

### `matches/<matchId>.json`

`{ matchId, pairingId, game, sides: {X: seed, O: seed}, result, adapter, faultSummary, eventLogSha256, replay }`

- `result` = `{ winnerSide: 'X'|'O'|null, reason, turnCount, finalStateHash }`; `reason` is an upper-case code.
- `adapter` = `{ adapterId, adapterVersion, directWinnerSide: 'X'|'O'|null, criteria: [{ id, direction: 'HIGHER_WINS'|'LOWER_WINS', x, o }] }`
  — the public values of `FinalsGameAdapterResult` expressed per side; no raw bot output.
- `faultSummary` = `{ X: {recoverableTotal, lastErrorCode|null}, O: {...} }` (same public-safe fields as qualification results).
- `replay` = `{ path: 'replays/<matchId>.json', sha256 }` or `{ path: null, sha256: null }`.

### `replays/<matchId>.json`

The public spectator replay payload exactly as [spectator-replay-v1](spectator-replay-v1.md) defines it. The bundle
validator only checks the envelope (`schema === 'ott.spectator-replay'`, `schemaVersion === 1`, `matchId`) and
the forbidden-key scan; it does not duplicate the replay parser.

### Privacy rules

No artifact may contain a key matching `/seed$|^seed|password|secret|credential|stderr|object_?key|token/i`
(`FORBIDDEN_FIELD`), except an explicit allowlist of public names: `seeds`, `homeSeed`, `awaySeed`, `winnerSeed`,
`loserSeed`, `qualificationRank`, `seedingHash` at any depth, and the bare `seed` ordinal only at `seeds[].seed`,
`pairings[].home.seed` and `pairings[].away.seed`. `drawSeed`, a top-level `seed` or `header.seed` in a replay are rejected.

### Validation rules and error codes

Per artifact (in order): path → duplicate → media type → size → UTF-8 JSON → forbidden scan → strict schema.
Cross-artifact checks run only when every artifact parsed.

| Code | Meaning |
| --- | --- |
| `ARTIFACT_PATH_UNSUPPORTED`, `ARTIFACT_PATH_DUPLICATE`, `ARTIFACT_MEDIATYPE_INVALID`, `ARTIFACT_TOO_LARGE`, `ARTIFACT_JSON_INVALID` | Envelope-level problems. |
| `ARTIFACT_SCHEMA_INVALID`, `ARTIFACT_VERSION_UNSUPPORTED`, `ARTIFACT_ID_MISMATCH` | Unknown/missing property, wrong `schemaVersion`, id differs from the path. |
| `FORBIDDEN_FIELD` | Privacy rule above. |
| `BRACKET_MISSING`, `BRACKET_DUPLICATE`, `BRACKET_STRUCTURE_MISMATCH` | Not exactly one `bracket.json`; seeds not 1..8 or pairings/resolved rows differ from `createFinalsBracket`. |
| `SERIES_ORPHAN`, `SERIES_MISSING` | Series without a bracket pairing; `FINALIZED` pairing without a series. |
| `GAMES_INVALID` | Game list shape rule above (also a match id used twice). |
| `MATCH_ORPHAN`, `MATCH_MISSING`, `MATCH_INVALID` | Match not owned by a series game; finalized game without its match; match sides differ from the bracket seeds. |
| `REPLAY_REF_INVALID`, `REPLAY_ORPHAN` | Reference path/sha256/matchId mismatch; replay no match references. |
| `ADAPTER_INCONSISTENT` | Adapter id/version differs between matches of one bundle. |
| `OUTCOME_MISMATCH` | See below. |

**Outcome recomputation (server authority).** The validator recomputes, with the L06 functions, every game decision
(`decideFinalsGame`), every series (`scoreFinalsSeries`, a game after the clinch is refused) and every `resolved[]` row
(`resolveBracket`), and requires equality with the declared `winnerSide`, series `outcome`/`state` and `resolved[]`.
The UI therefore never computes a winner or advancement.

### Versioning

Adding, removing or renaming a field requires a new `schemaVersion` (strict parsers reject unknown properties). A
reader supports only the versions it lists; others give `ARTIFACT_VERSION_UNSUPPORTED`.

### Worked example (abridged)

```json
// bracket.json
{"schema":"ott.finals.bracket","schemaVersion":1,"tournamentId":"tournament-1","finalsRuleSetId":"finals-rules-1",
 "bronzeMatchEnabled":true,"seedingHash":"<64 hex>","drawSeedCommitment":"<64 hex>",
 "seeds":[{"seed":1,"teamName":"Team 1","qualificationRank":1,"rating":1580}],
 "pairings":[{"id":"QF1","round":"QUARTERFINAL","slot":1,"home":{"kind":"SEED","seed":1},"away":{"kind":"SEED","seed":8}}],
 "resolved":[{"id":"QF1","round":"QUARTERFINAL","state":"FINALIZED","homeSeed":1,"awaySeed":8,"winnerSeed":1,"loserSeed":8}]}
// series/QF1.json
{"schema":"ott.finals.series","schemaVersion":1,"pairingId":"QF1","round":"QUARTERFINAL","bestOf":3,"state":"FINALIZED",
 "games":[{"game":1,"homeSide":"X","awaySide":"O","mapId":"map-a","matchId":"m-QF1-1","state":"FINALIZED"}],
 "outcome":{"winnerSeed":1,"loserSeed":8,"homeGameWins":2,"awayGameWins":0,"decisionBasis":"QUALIFICATION_SEED"}}
```
