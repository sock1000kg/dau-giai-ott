# Finals ResultBundle v1

> **Status:** LOCKED cryptographic envelope. Machine implementation is delivered by `P3-D09` in
> `src/platform/api/src/modules/result-bundles/` with migration `0016_result_bundles.sql`.

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
| Persistence | `src/platform/api/migrations/0016_result_bundles.sql` |
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

