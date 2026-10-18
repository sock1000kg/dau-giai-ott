import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.ts';
import { executeTransition } from '../src/modules/rounds/service.ts';

const ROUND_ID = 'round-1';
const RULE_SET_ID = 'rule-set-1';

class FakeRoundDatabase {
  public audits: string[] = [];
  public transactions = 0;
  public round: Record<string, unknown> = {
    id: ROUND_ID,
    tournament_stage: 'QUALIFICATION',
    round_number: 1,
    status: 'SUBMISSION_CLOSED',
    rule_set_id: RULE_SET_ID,
    schedule_round_id: null,
    start_idempotency_key: null,
    start_request_hash: null,
    paused_at: null,
    created_at: new Date('2026-10-14T00:00:00.000Z'),
  };

  public async query(text: string, values: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    if (text.includes('FOR UPDATE')) return { rows: [{ ...this.round }] };
    if (text.startsWith('SELECT id, tournament_stage, round_number')) return { rows: [{ ...this.round }] };
    if (text.includes('SET start_idempotency_key')) {
      this.round.start_idempotency_key = values[1] as string;
      this.round.start_request_hash = values[2] as string;
      return { rows: [] };
    }
    if (text.includes("status = 'RUNNING'")) {
      this.round.status = 'RUNNING';
      this.round.schedule_round_id = values[1] as string;
      return { rows: [] };
    }
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

describe('P3-D01 round-rules start orchestration', () => {
  it('runs scheduleRound on the root database, never inside a transaction', async () => {
    const database = new FakeRoundDatabase();
    const scheduleInputs: unknown[] = [];
    const rootTransaction = database.transaction.bind(database);
    const transitionDatabase = {
      query: (text: string, values?: readonly unknown[]) => database.query(text, values),
      transaction: rootTransaction,
      close: () => database.close(),
    } as unknown as Database;

    const result = await executeTransition(
      transitionDatabase,
      { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-1' }, reason: 'start round', actorAccountId: 'acc-1' },
      {
        scheduleRound: async (schedulingDatabase, input) => {
          if (schedulingDatabase !== transitionDatabase) {
            throw new Error('scheduleRound received a transaction-scoped database');
          }
          scheduleInputs.push(input);
          return { roundId: 'schedule-1' };
        },
      },
    );

    expect(result.status).toBe('RUNNING');
    expect(result.scheduleRoundId).toBe('schedule-1');
    expect(scheduleInputs).toEqual([{ tournamentStage: 'QUALIFICATION', idempotencyKey: `round-start:${ROUND_ID}`, qualificationRoundId: ROUND_ID }]);
    expect(database.audits).toEqual(['ROUND_START_INITIATED', 'ROUND_STARTED']);
    expect(database.round.status).toBe('RUNNING');
  });

  it('replays the same idempotency key without a second schedule or audit', async () => {
    const database = new FakeRoundDatabase();
    const transitionDatabase = database as unknown as Database;
    let scheduleCount = 0;
    const options = {
      scheduleRound: async () => {
        scheduleCount += 1;
        return { roundId: 'schedule-1' };
      },
    };

    await executeTransition(
      transitionDatabase,
      { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-1' }, reason: 'start round', actorAccountId: 'acc-1' },
      options,
    );
    const replay = await executeTransition(
      transitionDatabase,
      { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-1' }, reason: 'retry same key', actorAccountId: 'acc-1' },
      options,
    );

    expect(replay.replayed).toBe(true);
    expect(replay.scheduleRoundId).toBe('schedule-1');
    expect(database.audits).toEqual(['ROUND_START_INITIATED', 'ROUND_STARTED']);
    expect(scheduleCount).toBe(2);
  });

  it('rejects a different idempotency key with IDEMPOTENCY_KEY_REUSED', async () => {
    const database = new FakeRoundDatabase();
    const options = { scheduleRound: async () => ({ roundId: 'schedule-1' }) };

    await executeTransition(
      database as unknown as Database,
      { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-1' }, reason: 'start round', actorAccountId: 'acc-1' },
      options,
    );

    await expect(
      executeTransition(
        database as unknown as Database,
        { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-2' }, reason: 'different key', actorAccountId: 'acc-1' },
        options,
      ),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });

  it('rejects start before close', async () => {
    const database = new FakeRoundDatabase();
    database.round.status = 'DRAFT_RULES';
    database.round.rule_set_id = null;

    await expect(
      executeTransition(
        database as unknown as Database,
        { roundId: ROUND_ID, action: { type: 'start', ruleSetId: RULE_SET_ID, idempotencyKey: 'key-1' }, reason: 'too early', actorAccountId: 'acc-1' },
        { scheduleRound: async () => ({ roundId: 'schedule-1' }) },
      ),
    ).rejects.toThrow('ROUND_TRANSITION_INVALID');
    expect(database.audits).toEqual([]);
  });
});
