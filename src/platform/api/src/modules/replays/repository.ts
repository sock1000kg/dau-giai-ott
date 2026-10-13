import { createHash } from 'node:crypto';
import type { QueryResultRow } from 'pg';

import type { Database } from '../../db/client.ts';
import type { ReplayCatalogEntry, ReplayCatalogPage, ReplayPublication, ReplayPublicationState } from './types.ts';

interface CatalogRow extends QueryResultRow {
  readonly total_count: string;
  readonly match_id: string;
  readonly series_id: string;
  readonly tournament_stage: string;
  readonly finalized_at: Date;
  readonly event_log_sha256: string;
  readonly publication_state: ReplayPublicationState | null;
  readonly created_at: Date | null;
  readonly updated_at: Date | null;
  readonly staged_at: Date | null;
  readonly published_at: Date | null;
  readonly x_team_id: string;
  readonly x_team_name: string;
  readonly o_team_id: string;
  readonly o_team_name: string;
}

interface PublicationRow extends QueryResultRow {
  readonly match_id: string;
  readonly state: ReplayPublicationState;
  readonly event_log_sha256: string;
  readonly created_at: Date;
  readonly updated_at: Date;
  readonly staged_at: Date | null;
  readonly published_at: Date | null;
}

interface ReplayIdentityRow extends QueryResultRow {
  readonly status: string;
  readonly event_log_key: string | null;
  readonly event_log_sha256: string | null;
}

interface ActorRow extends QueryResultRow {
  readonly role: string;
  readonly status: string;
}

export interface ReplayTransitionInput {
  readonly matchId: string;
  readonly actorAccountId: string;
  readonly idempotencyKey: string;
  readonly reason: string;
  /** SHA-256 independently verified by the caller against the private object bytes. */
  readonly verifiedEventLogSha256: string;
}

const replaySha256 = /^sha256:[0-9a-f]{64}$/;
const idempotencyPattern = /^[A-Za-z0-9._:-]{1,200}$/;

function publication(row: PublicationRow): ReplayPublication {
  return {
    matchId: row.match_id,
    state: row.state,
    eventLogSha256: row.event_log_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stagedAt: row.staged_at,
    publishedAt: row.published_at,
  };
}

function validateCommand(input: ReplayTransitionInput): string {
  if (!idempotencyPattern.test(input.idempotencyKey)) throw new Error('INVALID_IDEMPOTENCY_KEY');
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) throw new Error('INVALID_REPLAY_REASON');
  if (!replaySha256.test(input.verifiedEventLogSha256)) throw new Error('REPLAY_CHECKSUM_MISMATCH');
  return reason;
}

async function requireBtcActor(database: Database, accountId: string): Promise<void> {
  const result = await database.query<ActorRow>(
    'SELECT role, status FROM accounts WHERE id = $1', [accountId],
  );
  const actor = result.rows[0];
  if (actor?.role !== 'BTC_ADMIN' || actor.status !== 'ACTIVE') throw new Error('BTC_ADMIN_REQUIRED');
}

async function replayIdentity(database: Database, matchId: string, verifiedSha256: string): Promise<ReplayIdentityRow> {
  const result = await database.query<ReplayIdentityRow>(`
    SELECT m.status, r.event_log_key, r.event_log_sha256
    FROM matches m
    LEFT JOIN match_results r ON r.match_id = m.id
    WHERE m.id = $1
    FOR UPDATE OF m`, [matchId]);
  const row = result.rows[0];
  if (row?.status !== 'FINALIZED' || row.event_log_key === null || row.event_log_sha256 === null) {
    throw new Error('REPLAY_NOT_ELIGIBLE');
  }
  const expectedKey = `match-results/${matchId}/event-log/${row.event_log_sha256}.json`;
  if (!replaySha256.test(row.event_log_sha256) || row.event_log_sha256 !== verifiedSha256 || row.event_log_key !== expectedKey) {
    throw new Error('REPLAY_CHECKSUM_MISMATCH');
  }
  return row;
}

async function transitionReplay(
  database: Database,
  action: 'STAGE' | 'PUBLISH',
  input: ReplayTransitionInput,
): Promise<ReplayPublication> {
  const reason = validateCommand(input);
  const resultingState: ReplayPublicationState = action === 'STAGE' ? 'STAGED' : 'PUBLISHED';
  const requestHash = createHash('sha256').update(JSON.stringify({
    action,
    matchId: input.matchId,
    actorAccountId: input.actorAccountId,
    reason,
    verifiedEventLogSha256: input.verifiedEventLogSha256,
  })).digest('hex');

  return database.transaction(async (transaction) => {
    await requireBtcActor(transaction, input.actorAccountId);
    const identity = await replayIdentity(transaction, input.matchId, input.verifiedEventLogSha256);
    const priorEvent = await transaction.query<{ readonly request_hash: string; readonly match_id: string }>(
      'SELECT request_hash, match_id FROM replay_publication_events WHERE idempotency_key = $1', [input.idempotencyKey],
    );
    const prior = priorEvent.rows[0];
    if (prior !== undefined) {
      if (prior.request_hash !== requestHash || prior.match_id !== input.matchId) throw new Error('IDEMPOTENCY_KEY_REUSED');
      const current = await transaction.query<PublicationRow>(
        'SELECT match_id,state,event_log_sha256,created_at,updated_at,staged_at,published_at FROM replay_publications WHERE match_id=$1',
        [input.matchId],
      );
      const row = current.rows[0];
      if (row === undefined) throw new Error('REPLAY_PUBLICATION_MISSING');
      return publication(row);
    }

    if (action === 'STAGE') {
      await transaction.query(
        "INSERT INTO replay_publications (match_id,state,event_log_key,event_log_sha256) VALUES ($1,'PRIVATE',$2,$3) ON CONFLICT (match_id) DO NOTHING",
        [input.matchId, identity.event_log_key, identity.event_log_sha256],
      );
    }
    const currentResult = await transaction.query<PublicationRow>(
      'SELECT match_id,state,event_log_sha256,created_at,updated_at,staged_at,published_at FROM replay_publications WHERE match_id=$1 FOR UPDATE',
      [input.matchId],
    );
    const current = currentResult.rows[0];
    if (current === undefined) throw new Error('REPLAY_NOT_STAGED');
    if (current.event_log_sha256 !== input.verifiedEventLogSha256) throw new Error('REPLAY_CHECKSUM_MISMATCH');
    if (action === 'STAGE' && current.state !== 'PRIVATE') throw new Error('REPLAY_NOT_PRIVATE');
    if (action === 'PUBLISH' && current.state !== 'STAGED') throw new Error('REPLAY_NOT_STAGED');

    const updated = await transaction.query<PublicationRow>(
      'UPDATE replay_publications SET state=$2 WHERE match_id=$1 RETURNING match_id,state,event_log_sha256,created_at,updated_at,staged_at,published_at',
      [input.matchId, resultingState],
    );
    await transaction.query(
      'INSERT INTO replay_publication_events (match_id,action,resulting_state,idempotency_key,request_hash,actor_account_id,reason) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (idempotency_key) DO NOTHING',
      [input.matchId, action, resultingState, input.idempotencyKey, requestHash, input.actorAccountId, reason],
    );
    const persistedEvent = await transaction.query<{ readonly request_hash: string; readonly match_id: string }>(
      'SELECT request_hash,match_id FROM replay_publication_events WHERE idempotency_key=$1', [input.idempotencyKey],
    );
    if (persistedEvent.rows[0]?.request_hash !== requestHash || persistedEvent.rows[0]?.match_id !== input.matchId) {
      throw new Error('IDEMPOTENCY_KEY_REUSED');
    }
    const row = updated.rows[0];
    if (row === undefined) throw new Error('REPLAY_PUBLICATION_MISSING');
    return publication(row);
  });
}

export async function listReplayCatalog(
  database: Database,
  input: { readonly page: number; readonly pageSize: number },
): Promise<ReplayCatalogPage> {
  if (!Number.isSafeInteger(input.page) || input.page < 1 || input.page > 10000
    || !Number.isSafeInteger(input.pageSize) || input.pageSize < 1 || input.pageSize > 100) {
    throw new Error('INVALID_REPLAY_CATALOG_PAGE');
  }
  const result = await database.query<CatalogRow>(`
    SELECT COUNT(*) OVER ()::text AS total_count,
      m.id AS match_id, s.id AS series_id, s.tournament_stage, r.finalized_at, r.event_log_sha256,
      p.state AS publication_state, p.created_at, p.updated_at, p.staged_at, p.published_at,
      sx.team_id AS x_team_id, tx.name AS x_team_name,
      so.team_id AS o_team_id, too.name AS o_team_name
    FROM matches m
    JOIN series s ON s.id = m.series_id
    JOIN submissions sx ON sx.id = m.x_submission_id
    JOIN teams tx ON tx.id = sx.team_id
    JOIN submissions so ON so.id = m.o_submission_id
    JOIN teams too ON too.id = so.team_id
    JOIN match_results r ON r.match_id = m.id
    LEFT JOIN replay_publications p ON p.match_id = m.id
    WHERE m.status = 'FINALIZED'
      AND r.event_log_key = 'match-results/' || m.id::text || '/event-log/' || r.event_log_sha256 || '.json'
      AND r.event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'
    ORDER BY r.finalized_at DESC, m.id DESC
    LIMIT $1 OFFSET $2`, [input.pageSize, (input.page - 1) * input.pageSize]);
  const totalResult = result.rows.length === 0
    ? await database.query<{ readonly total_count: string }>(`
      SELECT COUNT(*)::text AS total_count
      FROM matches m
      JOIN match_results r ON r.match_id = m.id
      WHERE m.status = 'FINALIZED'
        AND r.event_log_key = 'match-results/' || m.id::text || '/event-log/' || r.event_log_sha256 || '.json'
        AND r.event_log_sha256 ~ '^sha256:[0-9a-f]{64}$'`)
    : undefined;
  const total = Number(result.rows[0]?.total_count ?? totalResult?.rows[0]?.total_count ?? 0);
  const items: ReplayCatalogEntry[] = result.rows.map((row) => ({
    matchId: row.match_id,
    state: row.publication_state ?? 'PRIVATE',
    eventLogSha256: row.event_log_sha256,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    stagedAt: row.staged_at,
    publishedAt: row.published_at,
    seriesId: row.series_id,
    stage: row.tournament_stage,
    finalizedAt: row.finalized_at,
    teamX: { id: row.x_team_id, name: row.x_team_name },
    teamO: { id: row.o_team_id, name: row.o_team_name },
  }));
  return { items, page: input.page, pageSize: input.pageSize, total, totalPages: Math.ceil(total / input.pageSize) };
}

export function stageReplay(database: Database, input: ReplayTransitionInput): Promise<ReplayPublication> {
  return transitionReplay(database, 'STAGE', input);
}

export function publishReplay(database: Database, input: ReplayTransitionInput): Promise<ReplayPublication> {
  return transitionReplay(database, 'PUBLISH', input);
}
