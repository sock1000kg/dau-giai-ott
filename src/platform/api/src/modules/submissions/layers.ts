import { randomUUID } from 'node:crypto';
import type { Database } from '../../db/client.ts';
import type { ObjectStorage } from '../../storage/s3.ts';

export interface OciLayerRecord {
  readonly digest: string;
  readonly mediaType: string;
  readonly sizeBytes: number;
  readonly storageKey: string;
  readonly isBaseLayer: boolean;
  readonly createdAt: Date;
}

export interface RecordSubmissionLayersInput {
  readonly submissionId: string;
  readonly layers: readonly {
    readonly digest: string;
    readonly mediaType: string;
    readonly sizeBytes: number;
    readonly storageKey?: string;
    readonly isBaseLayer?: boolean;
  }[];
}

export interface RecordSubmissionLayersResult {
  readonly totalLayers: number;
  readonly newLayersCount: number;
  readonly sharedLayersCount: number;
}

export interface DuplicateDetectionInput {
  readonly submissionId: string;
  readonly teamId: string;
  readonly manifestDigest: string;
  readonly nonBaseLayerDigests: readonly string[];
}

export interface DuplicateDetectionResult {
  readonly isDuplicate: boolean;
  readonly duplicateOfSubmissionId?: string;
  readonly matchType?: 'MANIFEST' | 'NON_BASE_LAYERS';
  readonly reason?: string;
}

export interface RetentionEvaluationResult {
  readonly prunableSubmissionIds: readonly string[];
  readonly candidateLayerDigests: readonly string[];
  readonly candidateLayers: readonly {
    readonly digest: string;
    readonly storageKey: string;
    readonly sizeBytes: number;
  }[];
  readonly reclaimableBytes: number;
}

export interface RetentionReport {
  readonly dryRun: boolean;
  readonly prunedSubmissionsCount: number;
  readonly prunedSubmissionIds: readonly string[];
  readonly reclaimedLayersCount: number;
  readonly reclaimedLayerDigests: readonly string[];
  readonly reclaimedBytes: number;
}

/**
 * Records OCI layers and their association with a submission.
 * Deduplicates layers by digest in oci_layers and updates references in submission_layers.
 */
export async function recordSubmissionLayers(
  db: Database,
  input: RecordSubmissionLayersInput,
): Promise<RecordSubmissionLayersResult> {
  let newLayersCount = 0;
  let sharedLayersCount = 0;

  for (let order = 0; order < input.layers.length; order += 1) {
    const layer = input.layers[order]!;
    const storageKey = layer.storageKey ?? `layers/sha256/${layer.digest.replace(/^sha256:/, '')}`;
    const isBaseLayer = Boolean(layer.isBaseLayer);

    // Upsert into oci_layers
    const upsertRes = await db.query<{ is_new: boolean }>(
      `INSERT INTO oci_layers (digest, media_type, size_bytes, storage_key, is_base_layer)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (digest) DO UPDATE
         SET is_base_layer = oci_layers.is_base_layer OR EXCLUDED.is_base_layer
       RETURNING (xmax = 0) AS is_new`,
      [layer.digest, layer.mediaType, layer.sizeBytes, storageKey, isBaseLayer],
    );

    const isNew = upsertRes.rows[0]?.is_new ?? false;
    if (isNew) {
      newLayersCount += 1;
    } else {
      sharedLayersCount += 1;
    }

    // Insert into submission_layers junction table
    await db.query(
      `INSERT INTO submission_layers (submission_id, layer_digest, layer_order)
       VALUES ($1, $2, $3)
       ON CONFLICT (submission_id, layer_digest) DO NOTHING`,
      [input.submissionId, layer.digest, order],
    );
  }

  return {
    totalLayers: input.layers.length,
    newLayersCount,
    sharedLayersCount,
  };
}

/**
 * AC-22: Detects duplicate submissions by checking manifest digest or identical non-base layers
 * against submissions from other teams or sample bots.
 * If duplicate: flags duplicate_review_flag = true, records duplicate_of_submission_id,
 * and writes an audit event for BTC review without auto-disqualification.
 */
export async function checkDuplicateSubmission(
  db: Database,
  input: DuplicateDetectionInput,
): Promise<DuplicateDetectionResult> {
  // 1. Check for exact manifest digest match across other teams
  const manifestMatch = await db.query<{ id: string; team_id: string }>(
    `SELECT id, team_id
     FROM submissions
     WHERE oci_manifest_digest = $1
       AND id <> $2
       AND (team_id <> $3 OR team_id IS NULL)
       AND duplicate_review_flag IS NOT TRUE
       AND NOT EXISTS (
         SELECT 1 FROM submissions earlier
         WHERE earlier.team_id = $3
           AND earlier.oci_manifest_digest = $1
           AND earlier.created_at <= submissions.created_at
       )
     ORDER BY created_at ASC
     LIMIT 1`,
    [input.manifestDigest, input.submissionId, input.teamId],
  );

  if (manifestMatch.rows.length > 0) {
    const matched = manifestMatch.rows[0]!;
    const reason = `Identical OCI manifest digest matches submission ${matched.id} of team ${matched.team_id}`;

    await flagDuplicate(db, input.submissionId, matched.id, 'MANIFEST', reason, input.teamId, matched.team_id);
    return {
      isDuplicate: true,
      duplicateOfSubmissionId: matched.id,
      matchType: 'MANIFEST',
      reason,
    };
  }

  // 2. Check for identical non-base layers across other teams
  if (input.nonBaseLayerDigests.length > 0) {
    const layerCount = input.nonBaseLayerDigests.length;
    const layerMatch = await db.query<{ submission_id: string; team_id: string }>(
      `SELECT sl.submission_id, s.team_id
       FROM submission_layers sl
       JOIN submissions s ON s.id = sl.submission_id
       JOIN oci_layers ol ON ol.digest = sl.layer_digest
       WHERE s.id <> $1
         AND (s.team_id <> $2 OR s.team_id IS NULL)
         AND s.duplicate_review_flag IS NOT TRUE
         AND ol.is_base_layer = FALSE
         AND sl.layer_digest = ANY($3::text[])
       GROUP BY sl.submission_id, s.team_id, s.created_at
       HAVING COUNT(DISTINCT sl.layer_digest) = $4
          AND (
            SELECT COUNT(DISTINCT sl2.layer_digest)
            FROM submission_layers sl2
            JOIN oci_layers ol2 ON ol2.digest = sl2.layer_digest
            WHERE sl2.submission_id = sl.submission_id AND ol2.is_base_layer = FALSE
          ) = $4
       ORDER BY s.created_at ASC
       LIMIT 1`,
      [input.submissionId, input.teamId, input.nonBaseLayerDigests, layerCount],
    );

    if (layerMatch.rows.length > 0) {
      const matched = layerMatch.rows[0]!;
      const reason = `Identical custom non-base layers match submission ${matched.submission_id} of team ${matched.team_id}`;

      await flagDuplicate(db, input.submissionId, matched.submission_id, 'NON_BASE_LAYERS', reason, input.teamId, matched.team_id);
      return {
        isDuplicate: true,
        duplicateOfSubmissionId: matched.submission_id,
        matchType: 'NON_BASE_LAYERS',
        reason,
      };
    }
  }

  return { isDuplicate: false };
}

async function flagDuplicate(
  db: Database,
  submissionId: string,
  matchedSubmissionId: string,
  matchType: 'MANIFEST' | 'NON_BASE_LAYERS',
  reason: string,
  teamId: string,
  matchedTeamId: string,
): Promise<void> {
  // Update submission table flags
  await db.query(
    `UPDATE submissions
     SET duplicate_of_submission_id = $1,
         duplicate_review_flag = TRUE,
         duplicate_review_reason = $2
     WHERE id = $3`,
    [matchedSubmissionId, reason, submissionId],
  );

  // Record audit event for BTC review (idempotent on replay)
  const existingAudit = await db.query(
    `SELECT 1 FROM audit_events WHERE target_id = $1 AND action = 'DUPLICATE_SUBMISSION_FLAGGED' LIMIT 1`,
    [submissionId],
  );

  if (existingAudit.rows.length === 0) {
    const auditId = randomUUID();
    const details = JSON.stringify({
      duplicateOfSubmissionId: matchedSubmissionId,
      matchType,
      submissionTeamId: teamId,
      matchedTeamId,
    });

    await db.query(
      `INSERT INTO audit_events (id, actor_account_id, action, target_type, target_id, reason, details)
       VALUES ($1, NULL, 'DUPLICATE_SUBMISSION_FLAGGED', 'SUBMISSION', $2, $3, $4::jsonb)`,
      [auditId, submissionId, reason, details],
    );
  }
}

/**
 * D-18 Retention Policy evaluation:
 * Invariants:
 * 1. ACTIVE submissions are NEVER pruned.
 * 2. Submissions used in official matches (x_submission_id, o_submission_id) are NEVER pruned.
 * 3. The 3 most recent submissions per team are ALWAYS preserved.
 *
 * Layers with 0 references remaining after pruning candidate submissions are identified.
 */
export async function evaluateRetention(db: Database): Promise<RetentionEvaluationResult> {
  // Find prunable submissions adhering to D-18 invariants
  const prunableRes = await db.query<{ id: string }>(
    `WITH ranked_submissions AS (
       SELECT
         id,
         team_id,
         status,
         created_at,
         ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY created_at DESC) as team_rank
       FROM submissions
     ),
     protected_match_submissions AS (
       SELECT x_submission_id AS submission_id FROM matches WHERE x_submission_id IS NOT NULL
       UNION
       SELECT o_submission_id AS submission_id FROM matches WHERE o_submission_id IS NOT NULL
     )
     SELECT rs.id
     FROM ranked_submissions rs
     WHERE rs.status <> 'ACTIVE'
       AND rs.team_rank > 3
       AND rs.id NOT IN (SELECT submission_id FROM protected_match_submissions)
     ORDER BY rs.created_at ASC`,
  );

  const prunableSubmissionIds = prunableRes.rows.map((r) => r.id);

  if (prunableSubmissionIds.length === 0) {
    return {
      prunableSubmissionIds: [],
      candidateLayerDigests: [],
      candidateLayers: [],
      reclaimableBytes: 0,
    };
  }

  // Find layers that would have 0 remaining references if prunable submissions are removed
  const candidateLayersRes = await db.query<{ digest: string; storage_key: string; size_bytes: string | number }>(
    `SELECT l.digest, l.storage_key, l.size_bytes
     FROM oci_layers l
     WHERE NOT EXISTS (
       SELECT 1
       FROM submission_layers sl
       WHERE sl.layer_digest = l.digest
         AND sl.submission_id <> ALL($1::uuid[])
     )`,
    [prunableSubmissionIds],
  );

  const candidateLayers = candidateLayersRes.rows.map((r) => ({
    digest: r.digest,
    storageKey: r.storage_key,
    sizeBytes: Number(r.size_bytes),
  }));

  const candidateLayerDigests = candidateLayers.map((l) => l.digest);
  const reclaimableBytes = candidateLayers.reduce((sum, l) => sum + l.sizeBytes, 0);

  return {
    prunableSubmissionIds,
    candidateLayerDigests,
    candidateLayers,
    reclaimableBytes,
  };
}

/**
 * Runs the retention pruning process.
 * If dryRun is true: returns report without modifying database or storage.
 * If dryRun is false: safely deletes prunable submissions and unreferenced layers from DB and storage.
 * Handles race conditions via atomic conditional deletes.
 */
export async function runRetentionPrune(
  db: Database,
  storage: ObjectStorage | null,
  options: { readonly dryRun: boolean },
): Promise<RetentionReport> {
  const evaluation = await evaluateRetention(db);

  if (options.dryRun) {
    return {
      dryRun: true,
      prunedSubmissionsCount: evaluation.prunableSubmissionIds.length,
      prunedSubmissionIds: evaluation.prunableSubmissionIds,
      reclaimedLayersCount: evaluation.candidateLayerDigests.length,
      reclaimedLayerDigests: evaluation.candidateLayerDigests,
      reclaimedBytes: evaluation.reclaimableBytes,
    };
  }

  if (evaluation.prunableSubmissionIds.length === 0) {
    return {
      dryRun: false,
      prunedSubmissionsCount: 0,
      prunedSubmissionIds: [],
      reclaimedLayersCount: 0,
      reclaimedLayerDigests: [],
      reclaimedBytes: 0,
    };
  }

  // 1. Delete prunable submissions (submission_layers cascades)
  await db.query(
    `DELETE FROM submissions WHERE id = ANY($1::uuid[])`,
    [evaluation.prunableSubmissionIds],
  );

  // 2. Query layers with 0 remaining references and delete them with race check
  const actuallyReclaimedDigests: string[] = [];
  let actuallyReclaimedBytes = 0;

  for (const layer of evaluation.candidateLayers) {
    // Atomic check: only delete if still has 0 references
    const deleteRes = await db.query<{ digest: string; storage_key: string; size_bytes: string | number }>(
      `DELETE FROM oci_layers
       WHERE digest = $1
         AND digest NOT IN (SELECT layer_digest FROM submission_layers)
       RETURNING digest, storage_key, size_bytes`,
      [layer.digest],
    );

    if (deleteRes.rows.length > 0) {
      const deletedRow = deleteRes.rows[0]!;
      actuallyReclaimedDigests.push(deletedRow.digest);
      actuallyReclaimedBytes += Number(deletedRow.size_bytes);

      if (storage) {
        try {
          await storage.remove(deletedRow.storage_key);
        } catch {
          // Storage delete failures should be logged/tracked but not break DB consistency
        }
      }
    }
  }

  return {
    dryRun: false,
    prunedSubmissionsCount: evaluation.prunableSubmissionIds.length,
    prunedSubmissionIds: evaluation.prunableSubmissionIds,
    reclaimedLayersCount: actuallyReclaimedDigests.length,
    reclaimedLayerDigests: actuallyReclaimedDigests,
    reclaimedBytes: actuallyReclaimedBytes,
  };
}

/**
 * Gets layers associated with a given submission.
 */
export async function getSubmissionLayers(
  db: Database,
  submissionId: string,
): Promise<readonly OciLayerRecord[]> {
  const result = await db.query<{
    digest: string;
    media_type: string;
    size_bytes: string | number;
    storage_key: string;
    is_base_layer: boolean;
    created_at: Date;
  }>(
    `SELECT ol.digest, ol.media_type, ol.size_bytes, ol.storage_key, ol.is_base_layer, ol.created_at
     FROM oci_layers ol
     JOIN submission_layers sl ON sl.layer_digest = ol.digest
     WHERE sl.submission_id = $1
     ORDER BY sl.layer_order ASC`,
    [submissionId],
  );

  return result.rows.map((r) => ({
    digest: r.digest,
    mediaType: r.media_type,
    sizeBytes: Number(r.size_bytes),
    storageKey: r.storage_key,
    isBaseLayer: r.is_base_layer,
    createdAt: r.created_at,
  }));
}

/**
 * Gets reference count of a layer across all submissions.
 */
export async function getLayerReferenceCount(db: Database, digest: string): Promise<number> {
  const result = await db.query<{ count: string | number }>(
    `SELECT COUNT(*) as count FROM submission_layers WHERE layer_digest = $1`,
    [digest],
  );
  return Number(result.rows[0]?.count ?? 0);
}

