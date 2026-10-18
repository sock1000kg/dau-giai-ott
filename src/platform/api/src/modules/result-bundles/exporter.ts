import { createPrivateKey, sign as signMessage } from 'node:crypto';

import { canonicalizeJson, sha256HexOf } from './canonical.ts';
import {
  parseResultBundleManifest,
  type ResultBundleArtifactPayload,
  type ResultBundleCorrection,
  type ResultBundleManifestV1,
} from './importer.ts';

/**
 * P3-D09 offline exporter.
 *
 * The Ed25519 private key exists only on the offline/finals side and is never committed or copied to
 * the hosted system, so this module is a library the LAN tooling uses to produce a bundle; the hosted
 * API only ever imports (`importer.ts`). The manifest is canonicalized with RFC 8785 before signing,
 * and the signature covers the canonical text, not the caller's serialization.
 */

export interface ResultBundleArtifactInput {
  readonly path: string;
  readonly mediaType: string;
  readonly payload: Uint8Array;
}

export interface BuildResultBundleInput {
  readonly bundleId: string;
  readonly bundleVersion: number;
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly keyId: string;
  /** UTC RFC 3339 timestamp chosen by the offline side. */
  readonly createdAt: string;
  readonly correctionOf?: ResultBundleCorrection;
  readonly artifacts: readonly ResultBundleArtifactInput[];
}

export interface SignedResultBundle {
  readonly manifest: ResultBundleManifestV1;
  /** The exact bytes that were signed; the hosted importer re-derives them. */
  readonly canonicalManifest: string;
  readonly signature: string;
  readonly artifacts: readonly ResultBundleArtifactPayload[];
}

/** Builds and signs one bundle. `privateKeyPem` must never leave the offline finals environment. */
export function buildSignedResultBundle(
  input: BuildResultBundleInput,
  privateKeyPem: string,
): SignedResultBundle {
  if (input.artifacts.length === 0) throw new Error('RESULT_BUNDLE_MANIFEST_INVALID');

  const manifest = parseResultBundleManifest({
    schemaVersion: 1,
    bundleId: input.bundleId,
    bundleVersion: input.bundleVersion,
    tournamentId: input.tournamentId,
    finalsRuleSetId: input.finalsRuleSetId,
    keyId: input.keyId,
    createdAt: input.createdAt,
    ...(input.correctionOf === undefined ? {} : { correctionOf: input.correctionOf }),
    artifacts: input.artifacts.map((artifact) => ({
      path: artifact.path,
      mediaType: artifact.mediaType,
      sha256: sha256HexOf(artifact.payload),
      bytes: artifact.payload.byteLength,
    })),
  });

  const canonicalManifest = canonicalizeJson(manifest);
  const signature = signMessage(
    null,
    Buffer.from(canonicalManifest, 'utf8'),
    createPrivateKey(privateKeyPem),
  ).toString('base64');

  return {
    manifest,
    canonicalManifest,
    signature,
    artifacts: input.artifacts.map((artifact) => ({ path: artifact.path, payload: artifact.payload })),
  };
}
