import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { validateOciSubmission } from '@ott/job-contract';
import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireRole } from '../auth/authorize.ts';
import type { ObjectStorage } from '../../storage/s3.ts';

const limits = { maxArchiveBytes: 256 * 1024 * 1024, maxUncompressedBytes: 512 * 1024 * 1024 };
export interface SubmissionRoutesOptions { readonly database: Database; readonly storage: ObjectStorage; }

interface SubmissionListQuery {
  readonly page?: string;
  readonly pageSize?: string;
}

function paginationValue(value: string | undefined, fallback: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= max ? parsed : null;
}

export function registerSubmissionRoutes(app: FastifyInstance, options: SubmissionRoutesOptions): void {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body));
  app.get<{ Querystring: SubmissionListQuery }>('/api/v1/submissions', async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
    const page = paginationValue(request.query.page, 1, 100_000);
    const pageSize = paginationValue(request.query.pageSize, 20, 100);
    if (page === null || pageSize === null) return reply.status(400).send({ error: { code: 'INVALID_PAGINATION', message: 'Invalid page or pageSize' } });
    const offset = (page - 1) * pageSize;
    const count = await options.database.query<{ readonly total: string }>(
      'SELECT COUNT(*)::text AS total FROM submissions s WHERE s.team_id = $1',
      [principal.teamId],
    );
    const result = await options.database.query<{
      readonly id: string;
      readonly status: string;
      readonly archive_sha256: string;
      readonly created_at: Date;
    }>(
      'SELECT s.id, s.status, s.archive_sha256, s.created_at FROM submissions s WHERE s.team_id = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT $2 OFFSET $3',
      [principal.teamId, pageSize, offset],
    );
    return { data: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      archiveSha256: row.archive_sha256,
      createdAt: row.created_at.toISOString(),
    })), pagination: {
      page,
      pageSize,
      totalItems: Number(count.rows[0]?.total ?? '0'),
      totalPages: Math.ceil(Number(count.rows[0]?.total ?? '0') / pageSize),
    } };
  });
  app.post<{ Body: Buffer }>('/api/v1/submissions', { bodyLimit: limits.maxArchiveBytes }, async (request, reply) => {
    const principal = requireRole(requireAuthenticated(request.principal), 'TEAM_ACCOUNT');
    const archive = request.body;
    if (!(archive instanceof Buffer) || archive.byteLength === 0 || archive.byteLength > limits.maxArchiveBytes) return reply.status(400).send({ error: { code: 'ARCHIVE_TOO_LARGE', message: 'Invalid OCI archive' } });
    const quarantine = `quarantine/${randomUUID()}.oci.tar`;
    await options.storage.put(quarantine, archive);
    const checked = validateOciSubmission(archive, limits);
    if (!checked.ok) { await options.storage.remove(quarantine); return reply.status(400).send({ error: { code: checked.code, message: 'OCI archive rejected' } }); }
    const objectKey = `submissions/${checked.value.archiveSha256.slice('sha256:'.length)}.oci.tar`;
    try {
      await options.storage.copy(quarantine, objectKey);
      const id = randomUUID();
      await options.database.query("INSERT INTO submissions (id, team_id, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, platform, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'PREFLIGHT')", [id, principal.teamId, checked.value.archiveSha256, checked.value.ociManifestDigest, checked.value.ociConfigDigest, JSON.stringify(checked.value.entrypoint), checked.value.platform, objectKey, 'P2_BASELINE_V1']);
      return reply.status(201).send({ data: { id, status: 'PREFLIGHT', archiveSha256: checked.value.archiveSha256, ociManifestDigest: checked.value.ociManifestDigest, ociConfigDigest: checked.value.ociConfigDigest, policyVersion: 'P2_BASELINE_V1' } });
    } catch (error) { await options.storage.remove(objectKey).catch(() => undefined); throw error; } finally { await options.storage.remove(quarantine).catch(() => undefined); }
  });
}
