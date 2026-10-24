import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.ts';
import { executeTransition } from '../src/modules/rounds/service.ts';

const ROUND_ID = 'round-1';

interface FakeRound {
  id: string;
  tournament_stage: string;
  round_number: number;
  status: string;
  rule_set_id: string | null;
  schedule_round_id: string | null;
  paused_at: Date | null;
  created_at: Date;
}

class FakeReconcileDatabase {
  public audits: string[] = [];
  public transactions = 0;
  public seriesStatuses: string[] = ['FINALIZED'];
  public round: FakeRound = {
    id: ROUND_ID,
    tournament_stage: 'QUALIFICATION',
    round_number: 1,
    status: 'SETTLING',
    rule_set_id: 'rule-set-1',
    schedule_round_id: 'schedule-1',
    paused_at: null,
    created_at: new Date('2026-10-14T00:00:00.000Z'),
  };

  public async query(text: string, values: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    if (text.includes('FOR UPDATE')) return { rows: [{ ...this.round }] };
    if (text.startsWith('SELECT id, tournament_stage, round_number')) return { rows: [{ ...this.round }] };
    if (text.includes('FROM series')) return { rows: this.seriesStatuses.map((status) => ({ status })) };
    if (text.includes("status = 'SETTLING'")) {
      this.round.status = 'SETTLING';
      return { rows: [] };
    }
    if (text.includes("status = 'RATED'")) {
      this.round.status = 'RATED';
      return { rows: [] };
    }
    if (text.includes("status = 'PUBLISHED'")) {
      this.round.status = 'PUBLISHED';
      return { rows: [] };
    }
    if (text.includes('FROM matches m') || text.includes('FROM rating_ledger')) return { rows: [] };
    if (text.startsWith('INSERT INTO audit_events')) {
      this.audits.push(values[2] as string);
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  public async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    this.transactions += 1;
    const transaction = {
      query: (text: string, values?: readonly unknown[]) => this.query(text, values),
      transaction: async () => {
        throw new Error('Nested transactions are not supported');
      },
      close: async () => {},
    };
    return work(transaction);
  }

  public async close(): Promise<void> {}
}

describe('P3-D01 round-rules reconcile orchestration', () => {
  it('applies ratings on the root database, never inside a transaction', async () => {
    const database = new FakeReconcileDatabase();
    const transitionDatabase = database as unknown as Database;
    let ratingsCalls = 0;

    const result = await executeTransition(
      transitionDatabase,
      { roundId: ROUND_ID, action: { type: 'reconcile' }, reason: 'apply ratings', actorAccountId: 'acc-1' },
      {
        applyRoundRatings: async (ratingsDatabase) => {
          if (ratingsDatabase !== transitionDatabase) {
            throw new Error('applyRoundRatings received a transaction-scoped database');
          }
          await ratingsDatabase.transaction(async () => undefined);
          ratingsCalls += 1;
          return { applied: true };
        },
      },
    );

    expect(result.status).toBe('PUBLISHED');
    expect(ratingsCalls).toBe(1);
    expect(database.audits).toEqual(['ROUND_RATED', 'ROUND_PUBLISHED']);
    expect(database.round.status).toBe('PUBLISHED');
  });

  it('stays RUNNING while a series is non-terminal', async () => {
    const database = new FakeReconcileDatabase();
    database.round.status = 'RUNNING';
    database.seriesStatuses = ['FINALIZED', 'RUNNING'];

    const result = await executeTransition(
      database as unknown as Database,
      { roundId: ROUND_ID, action: { type: 'reconcile' }, reason: 'check status', actorAccountId: 'acc-1' },
      { applyRoundRatings: async () => ({ applied: true }) },
    );

    expect(result.status).toBe('RUNNING');
    expect(database.audits).toEqual([]);
  });

  it('moves RUNNING to SETTLING once every series is terminal, with one audit', async () => {
    const database = new FakeReconcileDatabase();
    database.round.status = 'RUNNING';
    database.seriesStatuses = ['FINALIZED', 'CANCELLED'];

    const result = await executeTransition(
      database as unknown as Database,
      { roundId: ROUND_ID, action: { type: 'reconcile' }, reason: 'all terminal', actorAccountId: 'acc-1' },
      { applyRoundRatings: async () => ({ applied: true }) },
    );

    expect(result.status).toBe('SETTLING');
    expect(database.audits).toEqual(['ROUND_SETTLING']);
  });

  it('re-running reconcile after PUBLISHED is idempotent (no extra audit or ratings)', async () => {
    const database = new FakeReconcileDatabase();
    database.round.status = 'PUBLISHED';
    let ratingsCalls = 0;

    const result = await executeTransition(
      database as unknown as Database,
      { roundId: ROUND_ID, action: { type: 'reconcile' }, reason: 'idempotent ratings', actorAccountId: 'acc-1' },
      { applyRoundRatings: async () => { ratingsCalls += 1; return { applied: true }; } },
    );

    expect(result.status).toBe('PUBLISHED');
    expect(ratingsCalls).toBe(0);
    expect(database.audits).toEqual([]);
  });
});
