import { describe, expect, it } from 'vitest';
import type { GameResult } from '@ott/game-core';
import type { Database } from '@ott/platform-api';
import { persistFinalizedResult, type ClaimedMatch } from '../src/result-repository.ts';

describe('P2-T21 persisted match fault summaries', () => {
  it('stores both runner fault summaries in the official result row', async () => {
    const calls: Array<{ readonly sql: string; readonly values: readonly unknown[] }> = [];
    const database = {
      query: async (sql: string, values: readonly unknown[] = []) => {
        calls.push({ sql, values });
        if (sql.includes('SELECT status FROM matches')) return { rows: [{ status: 'RUNNING' }] };
        if (sql.includes('SELECT winner_side')) return { rows: [] };
        if (sql.includes('SELECT id FROM match_attempts')) return { rows: [{ id: 'attempt-1' }] };
        return { rows: [], rowCount: 1 };
      },
      transaction: async <T>(work: (transaction: Database) => Promise<T>) => work(database as unknown as Database),
      close: async () => undefined,
    } as unknown as Database;
    const faults = {
      X: { recoverableTotal: 2, recoverableConsecutive: 1, lastErrorCode: 'BOT_TIMEOUT' },
      O: { recoverableTotal: 0, recoverableConsecutive: 0, lastErrorCode: null },
    };

    await persistFinalizedResult(database, {
      claim: { attempt: { id: 'attempt-1', token: 'lease-1', attemptNumber: 1 }, config: { matchId: 'match-1', policyVersion: 'P2_BASELINE_V1' }, submissions: { X: {}, O: {} } } as unknown as ClaimedMatch,
      result: { winnerSide: 'O', reason: 'TURN_LIMIT', turnCount: 12, finalStateHash: 'a'.repeat(64), forfeitedSide: null } satisfies GameResult,
      events: [],
      eventLogKey: 'private/event-log',
      eventLogSha256: `sha256:${'b'.repeat(64)}`,
      faults,
    } as unknown as Parameters<typeof persistFinalizedResult>[1]);

    const insert = calls.find(({ sql }) => sql.includes('INSERT INTO match_results'));
    expect(insert?.sql).toContain('faults');
    expect(insert?.values.at(-1)).toBe(JSON.stringify(faults));
  });
});
