import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Database } from '../src/db/client.ts';
import { createTestRun, TestRunError, type TestRunEnqueuer } from '../src/modules/test-runs/service.ts';

function qr<Row extends QueryResultRow = QueryResultRow>(rows: Row[] = []): QueryResult<Row> {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] };
}

describe('test-run transactional outbox', () => {
  it('recovers a queue publish failure on an idempotent retry without duplicating the run', async () => {
    const teamId = randomUUID();
    const submissionId = randomUUID();
    const runId = randomUUID();
    const outboxId = randomUUID();
    let run: Record<string, unknown> | null = null;
    const state: { outbox: { id: string; payload: unknown; dispatched: boolean } | null } = { outbox: null };
    let inserts = 0;
    const database = {
      async query<Row extends QueryResultRow = QueryResultRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
        if (sql.includes('SELECT * FROM test_runs WHERE team_id')) return qr(run ? [run as unknown as Row] : []);
        if (sql.includes('COUNT(*) FILTER')) return qr([{ consumed: 0, reserved: 0 }] as unknown as Row[]);
        if (sql.includes('SELECT id, team_id, status FROM submissions')) return qr([{ id: submissionId, team_id: teamId, status: 'ACTIVE' }] as unknown as Row[]);
        if (sql.includes('FROM test_run_reference_bots')) return qr([{ id: 'btc-v1' }] as unknown as Row[]);
        if (sql.includes('INSERT INTO test_runs')) {
          inserts++;
          run = {
            id: runId, team_id: values?.[1], round_id: values?.[2], submission_id: values?.[3],
            opponent_type: values?.[4], opponent_submission_id: values?.[5], opponent_reference_bot: values?.[6],
            map_checksum: values?.[7], seed: values?.[8], created_at: values?.[9], idempotency_key: values?.[10],
            request_hash: values?.[11], status: 'QUEUED', quota_consumed: false,
          };
          return qr([run as unknown as Row]);
        }
        if (sql.includes('INSERT INTO test_run_outbox')) {
          state.outbox = { id: outboxId, payload: JSON.parse(String(values?.[1])), dispatched: false };
          return qr();
        }
        if (sql.includes('SELECT id, payload FROM test_run_outbox')) return qr(state.outbox && !state.outbox.dispatched ? [{ id: state.outbox.id, payload: state.outbox.payload } as unknown as Row] : []);
        if (sql.includes('UPDATE test_run_outbox')) {
          if (state.outbox && values?.[0] === state.outbox.id) state.outbox.dispatched = true;
          return qr();
        }
        return qr();
      },
      async transaction<T>(work: (tx: Database) => Promise<T>): Promise<T> { return work(this as unknown as Database); },
      async close() {},
    } as unknown as Database;

    let attempts = 0;
    const jobIds: string[] = [];
    const enqueuer: TestRunEnqueuer = {
      async enqueue(job, options) {
        attempts++;
        jobIds.push(job.matchId);
        expect(options).toMatchObject({ category: 'test-run' });
        if (attempts === 1) throw new Error('temporary queue outage');
        return { jobId: job.matchId };
      },
    };
    const input = {
      teamId, submissionId, opponentType: 'BTC_REFERENCE' as const,
      opponentReferenceBot: 'btc-v1', idempotencyKey: 'test-run-outbox-key-001',
    };

    await expect(createTestRun(database, enqueuer, input)).rejects.toThrow('temporary queue outage');
    expect(state.outbox?.dispatched).toBe(false);
    const retried = await createTestRun(database, enqueuer, input);
    expect(retried.id).toBe(runId);
    expect(inserts).toBe(1);
    expect(attempts).toBe(2);
    expect(jobIds).toEqual([runId, runId]);
    expect(state.outbox?.dispatched).toBe(true);
    await createTestRun(database, enqueuer, input);
    expect(attempts).toBe(2);
    await expect(createTestRun(database, enqueuer, { ...input, submissionId: randomUUID() }))
      .rejects.toBeInstanceOf(TestRunError);
  });
});
