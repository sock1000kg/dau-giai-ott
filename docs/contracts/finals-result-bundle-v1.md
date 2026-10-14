# Finals ResultBundle v1

> **Status:** LOCKED cryptographic envelope for Phase 3 planning; JSON Schema/implementation are delivered by `P3-D09`.

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
