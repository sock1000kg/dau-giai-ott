import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validateOciSubmission } from '@ott/job-contract';
import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { ObjectStorage } from '../../storage/s3.ts';
import { UploadLimiter, type UploadLimiterOptions } from './upload-limiter.ts';
import {
  createReservation,
  getCurrentReservation,
  resolveUpload,
  SubmissionReservationError,
  type SubmissionReservationRow,
} from './reservations.ts';

const limits = { maxArchiveBytes: 256 * 1024 * 1024, maxUncompressedBytes: 512 * 1024 * 1024 };

export interface SubmissionRoutesOptions {
  readonly database: Database;
  readonly storage: ObjectStorage;
  readonly uploadLimiter?: UploadLimiterOptions | UploadLimiter | undefined;
  readonly now?: (() => Date) | undefined;
}

interface SubmissionListQuery {
  readonly page?: string;
  readonly pageSize?: string;
}

interface CreateReservationBody {
  readonly archiveSha256?: unknown;
}

function paginationValue(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

export function registerSubmissionRoutes(app: FastifyInstance, options: SubmissionRoutesOptions): void {
  const uploadLimiter =
    options.uploadLimiter instanceof UploadLimiter
      ? options.uploadLimiter
      : new UploadLimiter(options.uploadLimiter);
  const getNow = options.now ?? (() => new Date());

  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));

  // POST /api/v1/submission-reservations
  app.post<{ Body: CreateReservationBody }>('/api/v1/submission-reservations', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
    const { archiveSha256 } = request.body ?? {};
    if (typeof archiveSha256 !== 'string') {
      return reply.status(400).send({ error: { code: 'INVALID_ARCHIVE_SHA256', message: 'archiveSha256 must be a string' } });
    }

    try {
      const result = await createReservation(options.database, {
        teamId: principal.teamId,
        archiveSha256,
        now: getNow(),
      });
      return reply.status(result.statusCode).send({ data: result.data });
    } catch (error) {
      if (error instanceof SubmissionReservationError) {
        return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
      }
      throw error;
    }
  });

  // GET /api/v1/submission-reservations/current
  app.get('/api/v1/submission-reservations/current', async (request, _reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
    const data = await getCurrentReservation(options.database, principal.teamId, getNow());
    return { data };
  });

  // GET /api/v1/submissions
  app.get<{ Querystring: SubmissionListQuery }>('/api/v1/submissions', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
    const page = paginationValue(request.query.page, 1, 100_000);
    const pageSize = paginationValue(request.query.pageSize, 20, 100);
    if (page === null || pageSize === null) {
      return reply.status(400).send({ error: { code: 'INVALID_PAGINATION', message: 'Invalid page or pageSize' } });
    }
    const offset = (page - 1) * pageSize;

    const count = await options.database.query<{ readonly total: string }>(
      'SELECT COUNT(*)::text AS total FROM submissions s WHERE s.team_id = $1',
      [principal.teamId]
    );

    const preflightCount = await options.database.query<{ readonly count: string }>(
      "SELECT COUNT(*)::text AS count FROM submissions WHERE status = 'PREFLIGHT'"
    );

    const result = await options.database.query<{
      readonly id: string;
      readonly status: string;
      readonly archive_sha256: string;
      readonly created_at: Date;
      readonly preflight_position: number | string | null;
    }>(
      `SELECT
         s.id,
         s.status,
         s.archive_sha256,
         s.created_at,
         CASE
           WHEN s.status = 'PREFLIGHT' THEN (
             SELECT COUNT(*)::int
             FROM submissions p
             WHERE p.status = 'PREFLIGHT'
               AND (p.created_at < s.created_at OR (p.created_at = s.created_at AND p.id <= s.id))
           )
           ELSE NULL
         END AS preflight_position
       FROM submissions s
       WHERE s.team_id = $1
       ORDER BY s.created_at DESC, s.id DESC
       LIMIT $2 OFFSET $3`,
      [principal.teamId, pageSize, offset]
    );

    return {
      data: result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        archiveSha256: row.archive_sha256,
        createdAt: row.created_at.toISOString(),
        preflightPosition:
          row.preflight_position !== null && row.preflight_position !== undefined
            ? Number(row.preflight_position)
            : null,
      })),
      pagination: {
        page,
        pageSize,
        totalItems: Number(count.rows[0]?.total ?? '0'),
        totalPages: Math.ceil(Number(count.rows[0]?.total ?? '0') / pageSize),
      },
      preflightQueueLength: Number(preflightCount.rows[0]?.count ?? '0'),
    };
  });

  // POST /api/v1/submissions
  app.post<{ Body: Buffer }>(
    '/api/v1/submissions',
    {
      bodyLimit: limits.maxArchiveBytes,
      onRequest: async (request, reply) => {
        const principal = request.principal;
        if (principal?.role === 'TEAM_ACCOUNT' && principal.teamId) {
          const result = uploadLimiter.tryAcquire(principal.teamId);
          if (!result.acquired) {
            reply.header('Retry-After', String(result.retryAfter ?? 5));
            return reply.status(429).send({
              error: {
                code: 'UPLOAD_BUSY',
                message: 'Upload capacity reached. Try again later.',
              },
            });
          }
          let released = false;
          const release = () => {
            if (!released) {
              released = true;
              uploadLimiter.release(principal.teamId!);
            }
          };
          reply.raw.on('finish', release);
          reply.raw.on('close', release);
        }
      },
    },
    async (request, reply) => {
      const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
      const reservationHeader = request.headers['x-reservation-id'];
      const reservationId = typeof reservationHeader === 'string' ? reservationHeader : undefined;

      let uploadDecision;
      try {
        uploadDecision = await resolveUpload(options.database, {
          teamId: principal.teamId,
          reservationId,
          now: getNow(),
        });
      } catch (error) {
        if (error instanceof SubmissionReservationError) {
          return reply.status(error.status).send({ error: { code: error.code, message: error.message } });
        }
        throw error;
      }

      const archive = request.body;
      if (!(archive instanceof Buffer) || archive.byteLength === 0 || archive.byteLength > limits.maxArchiveBytes) {
        return reply.status(400).send({ error: { code: 'ARCHIVE_TOO_LARGE', message: 'Invalid OCI archive' } });
      }

      const quarantine = `quarantine/${randomUUID()}.oci.tar`;
      await options.storage.put(quarantine, archive);

      const checked = validateOciSubmission(archive, limits);
      if (!checked.ok) {
        await options.storage.remove(quarantine).catch(() => undefined);
        return reply.status(400).send({ error: { code: checked.code, message: 'OCI archive rejected' } });
      }

      if (
        uploadDecision.reservation !== null &&
        checked.value.archiveSha256 !== uploadDecision.reservation.archive_sha256
      ) {
        await options.storage.remove(quarantine).catch(() => undefined);
        return reply.status(409).send({
          error: {
            code: 'RESERVATION_HASH_MISMATCH',
            message: 'Archive SHA-256 does not match reservation',
          },
        });
      }

      const sha256Hex = checked.value.archiveSha256.slice('sha256:'.length);
      const objectKey = `submissions/${sha256Hex}/${randomUUID()}.oci.tar`;
      let createdNewObject = false;
      let keepObject = false;

      try {
        await options.storage.copy(quarantine, objectKey);
        createdNewObject = true;

        const result = await options.database.transaction(async (tx) => {
          if (uploadDecision.reservation !== null) {
            const lockedRes = await tx.query<SubmissionReservationRow>(
              'SELECT id, status, submission_id FROM submission_reservations WHERE id = $1 FOR UPDATE',
              [uploadDecision.reservation.id]
            );
            const currentRes = lockedRes.rows[0];
            if (currentRes?.status === 'COMPLETED' && currentRes.submission_id) {
              const existingSub = await tx.query<{
                readonly id: string;
                readonly status: string;
                readonly archive_sha256: string;
                readonly oci_manifest_digest: string;
                readonly oci_config_digest: string;
                readonly policy_version: string;
              }>(
                'SELECT id, status, archive_sha256, oci_manifest_digest, oci_config_digest, policy_version FROM submissions WHERE id = $1',
                [currentRes.submission_id]
              );
              const s = existingSub.rows[0];
              if (s) {
                return {
                  statusCode: 200 as const,
                  isRetry: true,
                  data: {
                    id: s.id,
                    status: s.status,
                    archiveSha256: s.archive_sha256,
                    ociManifestDigest: s.oci_manifest_digest,
                    ociConfigDigest: s.oci_config_digest,
                    policyVersion: s.policy_version,
                    reservationId: uploadDecision.reservation.id,
                  },
                };
              }
            }

            const submissionId = randomUUID();
            await tx.query(
              `INSERT INTO submissions (
                 id, team_id, qualification_round_id, archive_sha256, oci_manifest_digest,
                 oci_config_digest, entrypoint, platform, object_key, policy_version, status
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PREFLIGHT')`,
              [
                submissionId,
                principal.teamId,
                uploadDecision.round.id,
                checked.value.archiveSha256,
                checked.value.ociManifestDigest,
                checked.value.ociConfigDigest,
                JSON.stringify(checked.value.entrypoint),
                checked.value.platform,
                objectKey,
                'P2_BASELINE_V1',
              ]
            );

            const completedAt = getNow();
            await tx.query(
              'UPDATE submission_reservations SET status = $1, submission_id = $2, completed_at = $3 WHERE id = $4',
              ['COMPLETED', submissionId, completedAt, uploadDecision.reservation.id]
            );

            return {
              statusCode: 201 as const,
              isRetry: false,
              data: {
                id: submissionId,
                status: 'PREFLIGHT',
                archiveSha256: checked.value.archiveSha256,
                ociManifestDigest: checked.value.ociManifestDigest,
                ociConfigDigest: checked.value.ociConfigDigest,
                policyVersion: 'P2_BASELINE_V1',
                reservationId: uploadDecision.reservation.id,
              },
            };
          } else {
            const submissionId = randomUUID();
            await tx.query(
              `INSERT INTO submissions (
                 id, team_id, qualification_round_id, archive_sha256, oci_manifest_digest,
                 oci_config_digest, entrypoint, platform, object_key, policy_version, status
               ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PREFLIGHT')`,
              [
                submissionId,
                principal.teamId,
                uploadDecision.round.id,
                checked.value.archiveSha256,
                checked.value.ociManifestDigest,
                checked.value.ociConfigDigest,
                JSON.stringify(checked.value.entrypoint),
                checked.value.platform,
                objectKey,
                'P2_BASELINE_V1',
              ]
            );

            return {
              statusCode: 201 as const,
              isRetry: false,
              data: {
                id: submissionId,
                status: 'PREFLIGHT',
                archiveSha256: checked.value.archiveSha256,
                ociManifestDigest: checked.value.ociManifestDigest,
                ociConfigDigest: checked.value.ociConfigDigest,
                policyVersion: 'P2_BASELINE_V1',
              },
            };
          }
        });

        if (!result.isRetry) {
          keepObject = true;
        }

        return reply.status(result.statusCode).send({ data: result.data });
      } catch (error) {
        throw error;
      } finally {
        if (createdNewObject && !keepObject) {
          await options.storage.remove(objectKey).catch(() => undefined);
        }
        await options.storage.remove(quarantine).catch(() => undefined);
      }
    }
  );
}
