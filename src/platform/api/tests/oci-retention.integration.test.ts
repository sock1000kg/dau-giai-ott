import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/db/client.ts';
import type { ObjectStorage } from '../src/storage/s3.ts';
import {
  recordSubmissionLayers,
  checkDuplicateSubmission,
  evaluateRetention,
  runRetentionPrune,
  getSubmissionLayers,
  getLayerReferenceCount,
  type DuplicateDetectionInput,
} from '../src/modules/submissions/layers.ts';
import {
  extractOciLayersFromArchive,
  isOfficialBaseLayer,
  OFFICIAL_BASE_IMAGES,
} from '../../worker/src/artifacts.ts';

const SHA = (hex: string) => `sha256:${hex.padEnd(64, '0')}`;

describe('OCI Layer Dedup, AC-22 Duplicate Flag & D-18 Retention', () => {
  describe('Layer Deduplication and Reference Counting', () => {
    it('records layers and tracks shared vs new layers', async () => {
      const dbState = {
        ociLayers: new Map<string, { digest: string; media_type: string; size_bytes: number; storage_key: string; is_base_layer: boolean }>(),
        submissionLayers: new Map<string, { submission_id: string; layer_digest: string; layer_order: number }>(),
      };

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('INSERT INTO oci_layers')) {
            const [digest, mediaType, sizeBytes, storageKey, isBaseLayer] = params as [string, string, number, string, boolean];
            const isNew = !dbState.ociLayers.has(digest);
            const existing = dbState.ociLayers.get(digest);
            dbState.ociLayers.set(digest, {
              digest,
              media_type: mediaType,
              size_bytes: sizeBytes,
              storage_key: storageKey,
              is_base_layer: existing ? existing.is_base_layer || isBaseLayer : isBaseLayer,
            });
            return { rows: [{ is_new: isNew }] };
          }
          if (sql.includes('INSERT INTO submission_layers')) {
            const [submissionId, layerDigest, order] = params as [string, string, number];
            const key = `${submissionId}:${layerDigest}`;
            if (!dbState.submissionLayers.has(key)) {
              dbState.submissionLayers.set(key, { submission_id: submissionId, layer_digest: layerDigest, layer_order: order });
            }
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const sub1 = randomUUID();
      const baseLayer = SHA('b1');
      const customLayer1 = SHA('c1');

      // First submission records 2 layers (1 base, 1 custom)
      const res1 = await recordSubmissionLayers(mockDb, {
        submissionId: sub1,
        layers: [
          { digest: baseLayer, mediaType: 'application/vnd.oci.image.layer.v1.tar', sizeBytes: 5000, isBaseLayer: true },
          { digest: customLayer1, mediaType: 'application/vnd.oci.image.layer.v1.tar', sizeBytes: 1000, isBaseLayer: false },
        ],
      });

      expect(res1.totalLayers).toBe(2);
      expect(res1.newLayersCount).toBe(2);
      expect(res1.sharedLayersCount).toBe(0);

      // Second submission shares baseLayer, adds customLayer2
      const sub2 = randomUUID();
      const customLayer2 = SHA('c2');
      const res2 = await recordSubmissionLayers(mockDb, {
        submissionId: sub2,
        layers: [
          { digest: baseLayer, mediaType: 'application/vnd.oci.image.layer.v1.tar', sizeBytes: 5000, isBaseLayer: true },
          { digest: customLayer2, mediaType: 'application/vnd.oci.image.layer.v1.tar', sizeBytes: 1500, isBaseLayer: false },
        ],
      });

      expect(res2.totalLayers).toBe(2);
      expect(res2.newLayersCount).toBe(1);
      expect(res2.sharedLayersCount).toBe(1);
      expect(dbState.ociLayers.size).toBe(3); // baseLayer, customLayer1, customLayer2
    });
  });

  describe('AC-22: Duplicate Submission Flagging', () => {
    it('flags duplicate when manifest digest matches another team submission', async () => {
      const sub1 = randomUUID();
      const sub2 = randomUUID();
      const team1 = randomUUID();
      const team2 = randomUUID();
      const manifestDigest = SHA('manifest_identical');

      let updatedFlag = false;
      let recordedAudit = false;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('SELECT id, team_id') && sql.includes('WHERE oci_manifest_digest = $1')) {
            // Returns sub1 from team1
            return { rows: [{ id: sub1, team_id: team1 }] };
          }
          if (sql.includes('UPDATE submissions') && sql.includes('duplicate_review_flag = TRUE')) {
            updatedFlag = true;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO audit_events') && sql.includes('DUPLICATE_SUBMISSION_FLAGGED')) {
            recordedAudit = true;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const input: DuplicateDetectionInput = {
        submissionId: sub2,
        teamId: team2,
        manifestDigest,
        nonBaseLayerDigests: [SHA('c1')],
      };

      const result = await checkDuplicateSubmission(mockDb, input);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchType).toBe('MANIFEST');
      expect(result.duplicateOfSubmissionId).toBe(sub1);
      expect(updatedFlag).toBe(true);
      expect(recordedAudit).toBe(true);
    });

    it('flags duplicate when all custom non-base layers match another team', async () => {
      const sub1 = randomUUID();
      const sub2 = randomUUID();
      const team1 = randomUUID();
      const team2 = randomUUID();
      const customLayer = SHA('custom_layer_1');

      let updatedFlag = false;
      let recordedAudit = false;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('WHERE oci_manifest_digest = $1')) {
            // Manifest is different (e.g. different build timestamp)
            return { rows: [] };
          }
          if (sql.includes('SELECT sl.submission_id, s.team_id') && sql.includes('ol.is_base_layer = FALSE')) {
            // Matches non-base custom layers
            return { rows: [{ submission_id: sub1, team_id: team1 }] };
          }
          if (sql.includes('UPDATE submissions') && sql.includes('duplicate_review_flag = TRUE')) {
            updatedFlag = true;
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO audit_events') && sql.includes('DUPLICATE_SUBMISSION_FLAGGED')) {
            recordedAudit = true;
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const input: DuplicateDetectionInput = {
        submissionId: sub2,
        teamId: team2,
        manifestDigest: SHA('manifest_diff'),
        nonBaseLayerDigests: [customLayer],
      };

      const result = await checkDuplicateSubmission(mockDb, input);

      expect(result.isDuplicate).toBe(true);
      expect(result.matchType).toBe('NON_BASE_LAYERS');
      expect(result.duplicateOfSubmissionId).toBe(sub1);
      expect(updatedFlag).toBe(true);
      expect(recordedAudit).toBe(true);
    });

    it('does NOT flag duplicate when submission has unique custom layers', async () => {
      const mockDb = {
        query: vi.fn().mockImplementation(async () => {
          return { rows: [] };
        }),
      } as unknown as Database;

      const input: DuplicateDetectionInput = {
        submissionId: randomUUID(),
        teamId: randomUUID(),
        manifestDigest: SHA('unique_manifest'),
        nonBaseLayerDigests: [SHA('unique_custom')],
      };

      const result = await checkDuplicateSubmission(mockDb, input);

      expect(result.isDuplicate).toBe(false);
      expect(result.duplicateOfSubmissionId).toBeUndefined();
    });
  });

  describe('D-18 Retention Policy Invariants & Dry-Run Report', () => {
    it('generates a dry-run report without deleting any records or storage objects', async () => {
      const subToPrune = randomUUID();
      const orphanLayer = SHA('orphan_layer');

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('WITH ranked_submissions')) {
            // Returns subToPrune (rank > 3, status != ACTIVE, not in matches)
            return { rows: [{ id: subToPrune }] };
          }
          if (sql.includes('SELECT l.digest, l.storage_key, l.size_bytes')) {
            return {
              rows: [{ digest: orphanLayer, storage_key: `layers/sha256/${orphanLayer.slice(7)}`, size_bytes: 4096 }],
            };
          }
          if (sql.includes('DELETE FROM')) {
            throw new Error('Dry run must not execute DELETE!');
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const mockStorage: ObjectStorage = {
        put: vi.fn(),
        get: vi.fn(),
        copy: vi.fn(),
        remove: vi.fn().mockImplementation(async () => {
          throw new Error('Dry run must not call storage.remove!');
        }),
      };

      const report = await runRetentionPrune(mockDb, mockStorage, { dryRun: true });

      expect(report.dryRun).toBe(true);
      expect(report.prunedSubmissionsCount).toBe(1);
      expect(report.prunedSubmissionIds).toEqual([subToPrune]);
      expect(report.reclaimedLayersCount).toBe(1);
      expect(report.reclaimedLayerDigests).toEqual([orphanLayer]);
      expect(report.reclaimedBytes).toBe(4096);
      expect(mockStorage.remove).not.toHaveBeenCalled();
    });

    it('prunes submissions and deletes orphan layers on dryRun = false', async () => {
      const subToPrune = randomUUID();
      const orphanLayer = SHA('orphan_layer');
      const storageKey = `layers/sha256/${orphanLayer.slice(7)}`;

      let dbDeletedSubmissions = false;
      let dbDeletedLayer = false;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string, params?: readonly unknown[]) => {
          if (sql.includes('WITH ranked_submissions')) {
            return { rows: [{ id: subToPrune }] };
          }
          if (sql.includes('SELECT l.digest, l.storage_key, l.size_bytes')) {
            return {
              rows: [{ digest: orphanLayer, storage_key: storageKey, size_bytes: 4096 }],
            };
          }
          if (sql.includes('DELETE FROM submissions')) {
            dbDeletedSubmissions = true;
            return { rows: [] };
          }
          if (sql.includes('DELETE FROM oci_layers')) {
            dbDeletedLayer = true;
            return { rows: [{ digest: orphanLayer, storage_key: storageKey, size_bytes: 4096 }] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const removedKeys: string[] = [];
      const mockStorage: ObjectStorage = {
        put: vi.fn(),
        get: vi.fn(),
        copy: vi.fn(),
        remove: vi.fn().mockImplementation(async (key: string) => {
          removedKeys.push(key);
        }),
      };

      const report = await runRetentionPrune(mockDb, mockStorage, { dryRun: false });

      expect(report.dryRun).toBe(false);
      expect(report.prunedSubmissionsCount).toBe(1);
      expect(report.reclaimedLayersCount).toBe(1);
      expect(report.reclaimedBytes).toBe(4096);
      expect(dbDeletedSubmissions).toBe(true);
      expect(dbDeletedLayer).toBe(true);
      expect(removedKeys).toEqual([storageKey]);
    });

    it('protects against reference-count race condition when layer is re-referenced during prune', async () => {
      const subToPrune = randomUUID();
      const layerWithConcurrentRef = SHA('concurrent_layer');
      const storageKey = `layers/sha256/${layerWithConcurrentRef.slice(7)}`;

      const mockDb = {
        query: vi.fn().mockImplementation(async (sql: string) => {
          if (sql.includes('WITH ranked_submissions')) {
            return { rows: [{ id: subToPrune }] };
          }
          if (sql.includes('SELECT l.digest, l.storage_key, l.size_bytes')) {
            return {
              rows: [{ digest: layerWithConcurrentRef, storage_key: storageKey, size_bytes: 8192 }],
            };
          }
          if (sql.includes('DELETE FROM submissions')) {
            return { rows: [] };
          }
          if (sql.includes('DELETE FROM oci_layers')) {
            // Simulated race: concurrent upload referenced layer before delete executed
            // WHERE condition 'digest NOT IN (SELECT layer_digest FROM submission_layers)' matches 0 rows
            return { rows: [] };
          }
          return { rows: [] };
        }),
      } as unknown as Database;

      const mockStorage: ObjectStorage = {
        put: vi.fn(),
        get: vi.fn(),
        copy: vi.fn(),
        remove: vi.fn(),
      };

      const report = await runRetentionPrune(mockDb, mockStorage, { dryRun: false });

      // Submissions deleted, but layer deletion was skipped due to race check
      expect(report.prunedSubmissionsCount).toBe(1);
      expect(report.reclaimedLayersCount).toBe(0);
      expect(report.reclaimedBytes).toBe(0);
      // Storage object MUST NOT be removed!
      expect(mockStorage.remove).not.toHaveBeenCalled();
    });
  });

  describe('Official Base Images and Layer Extraction', () => {
    it('recognizes official base image layers for Python, Node, and Go', () => {
      expect(OFFICIAL_BASE_IMAGES.length).toBeGreaterThanOrEqual(3);

      for (const img of OFFICIAL_BASE_IMAGES) {
        expect(img.manifestDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
        expect(img.layerDigests.length).toBeGreaterThan(0);
        for (const layer of img.layerDigests) {
          expect(isOfficialBaseLayer(layer)).toBe(true);
        }
      }

      // Random custom layer is not base layer
      expect(isOfficialBaseLayer(SHA('random_custom'))).toBe(false);
    });

    it('extracts layer descriptors and separates base vs custom layers from OCI archive', () => {
      const enc = new TextEncoder();
      const text = (a: Uint8Array, o: number, n: number, v: string) => a.set(enc.encode(v).slice(0, n), o);
      const oct = (a: Uint8Array, o: number, n: number, v: number) => { text(a, o, n, v.toString(8).padStart(n - 1, '0')); a[o + n - 1] = 0; };
      const join = (...xs: Uint8Array[]) => { const n = xs.reduce((a, x) => a + x.length, 0); const r = new Uint8Array(n); let o = 0; for (const x of xs) { r.set(x, o); o += x.length; } return r; };
      const tar = (entries: readonly { name: string; body: Uint8Array }[]) => join(...entries.flatMap(({ name, body }) => { const h = new Uint8Array(512); text(h, 0, 100, name); oct(h, 100, 8, 0o644); oct(h, 124, 12, body.length); h.fill(32, 148, 156); h[156] = 48; text(h, 257, 6, 'ustar'); text(h, 263, 2, '00'); text(h, 148, 8, `${h.reduce((s, b) => s + b, 0).toString(8).padStart(6, '0')}\0 `); return [h, body, new Uint8Array((512 - body.length % 512) % 512)]; }), new Uint8Array(1024));

      const knownBase = OFFICIAL_BASE_IMAGES[0]!.layerDigests[0]!;
      const customLayerDigest = SHA('custom_app_code');

      const manifestObj = {
        schemaVersion: 2,
        config: { digest: SHA('config_digest') },
        layers: [
          { mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: knownBase, size: 1000 },
          { mediaType: 'application/vnd.oci.image.layer.v1.tar', digest: customLayerDigest, size: 200 },
        ],
      };
      const manifestBytes = enc.encode(JSON.stringify(manifestObj));
      const manifestDigest = SHA('manifest_digest');

      const indexObj = {
        schemaVersion: 2,
        manifests: [{ digest: manifestDigest }],
      };
      const indexBytes = enc.encode(JSON.stringify(indexObj));

      const archive = tar([
        { name: 'index.json', body: indexBytes },
        { name: `blobs/sha256/${manifestDigest.slice(7)}`, body: manifestBytes },
      ]);

      const extracted = extractOciLayersFromArchive(archive);

      expect(extracted.manifestDigest).toBe(manifestDigest);
      expect(extracted.layers.length).toBe(2);
      expect(extracted.baseLayerDigests).toEqual([knownBase]);
      expect(extracted.nonBaseLayerDigests).toEqual([customLayerDigest]);
    });
  });
});

