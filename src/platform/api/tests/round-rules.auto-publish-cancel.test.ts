import { describe, expect, it } from 'vitest';

import type { Database } from '../src/db/client.ts';
import { computeRoundResultsHash } from '../src/modules/operations/results-hash.ts';
import { collectQualificationSnapshot, type PublicEditorial } from '../src/modules/public-snapshots/source.ts';
import { createRound, executeTransition, getAllowedActions } from '../src/modules/rounds/service.ts';
import { ALLOWED_TRANSITIONS, computeRulesSha256, type RoundRuleSetRulesV1, type RoundStatus } from '../src/modules/rounds/types.ts';

const ROUND_ID = 'round-1';
const STAGE = 'QUALIFICATION';

interface FakeRound {
  id: string;
  tournament_stage: string;
  round_number: number;
  status: string;
  rule_set_id: string | null;
  schedule_round_id: string | null;
  start_idempotency_key: string | null;
  start_request_hash: string | null;
  paused_at: Date | null;
  created_at: Date;
  results_hash: string | null;
  published_at: Date | null;
  cancelled_at: Date | null;
  cancel_reason: string | null;
}

function baseRound(overrides: Partial<FakeRound> = {}): FakeRound {
  return {
    id: ROUND_ID, tournament_stage: STAGE, round_number: 1, status: 'SETTLING', rule_set_id: 'rule-set-1',
    schedule_round_id: 'schedule-1', start_idempotency_key: null, start_request_hash: null, paused_at: null,
    created_at: new Date('2026-10-14T00:00:00.000Z'), results_hash: null, published_at: null,
    cancelled_at: null, cancel_reason: null, ...overrides,
  };
}

class FakeRoundDatabase {
  public audits: { action: string; reason: string; details: Record<string, unknown> }[] = [];
  public rounds: FakeRound[];
  public ratingsLedger: { series_id: string; team_id: string; rating_before: number; rating_after: number; delta: number }[] = [
    { series_id: 's1', team_id: 't1', rating_before: 1000, rating_after: 1016, delta: 16 },
  ];

  public constructor(round: FakeRound = baseRound()) {
    this.rounds = [round];
  }

  public get round(): FakeRound {
    return this.rounds[0]!;
  }

  public async query(text: string, values: readonly unknown[] = []): Promise<{ rows: unknown[] }> {
    if (text.startsWith('INSERT INTO audit_events')) {
      this.audits.push({ action: values[2] as string, reason: values[5] as string, details: JSON.parse(values[7] as string) as Record<string, unknown> });
      return { rows: [] };
    }
    if (text.startsWith('UPDATE qualification_rounds')) {
      const target = this.rounds.find((row) => row.id === values[0])!;
      if (text.includes("status = 'RATED'")) target.status = 'RATED';
      else if (text.includes("status = 'PUBLISHED'")) {
        target.status = 'PUBLISHED';
        target.published_at = values[1] as Date;
        target.results_hash = values[2] as string;
      } else if (text.includes("status = 'CANCELLED'")) {
        target.status = 'CANCELLED';
        target.cancelled_at = values[1] as Date;
        target.cancel_reason = values[2] as string;
      } else throw new Error(`Unexpected update: ${text}`);
      return { rows: [] };
    }
    if (text.includes('FROM matches m')) return { rows: [] };
    if (text.includes('FROM rating_ledger')) return { rows: this.ratingsLedger };
    if (text.includes('FROM series')) return { rows: [{ status: 'FINALIZED' }] };
    if (text.includes('FOR UPDATE') || text.startsWith('SELECT id, tournament_stage, round_number')) {
      return { rows: this.rounds.filter((row) => row.id === values[0]).map((row) => ({ ...row })) };
    }
    if (text.startsWith('SELECT id FROM qualification_rounds WHERE tournament_stage')) {
      const excluded = [...text.matchAll(/status NOT IN \(([^)]*)\)/g)].flatMap((match) => [...(match[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]));
      return { rows: this.rounds.filter((row) => row.tournament_stage === values[0] && !excluded.includes(row.status)).map((row) => ({ id: row.id })) };
    }
    if (text.startsWith('SELECT MAX(round_number)')) {
      return { rows: [{ max_round: Math.max(0, ...this.rounds.map((row) => row.round_number)) }] };
    }
    if (text.startsWith('INSERT INTO qualification_rounds')) {
      this.rounds.push(baseRound({
        id: values[0] as string, round_number: values[2] as number, status: 'DRAFT_RULES', rule_set_id: null, schedule_round_id: null,
      }));
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${text}`);
  }

  public async transaction<T>(work: (transaction: unknown) => Promise<T>): Promise<T> {
    return work({
      query: (text: string, values?: readonly unknown[]) => this.query(text, values),
      transaction: async () => { throw new Error('Nested transactions are not supported'); },
      close: async () => {},
    });
  }

  public async close(): Promise<void> {}
}

function asDb(database: FakeRoundDatabase): Database {
  return database as unknown as Database;
}

const reconcile = (database: FakeRoundDatabase, reason = 'apply ratings') =>
  executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'reconcile' }, reason, actorAccountId: 'acc-1' }, { applyRoundRatings: async () => ({ applied: true }) });

describe('loop 101 part A: rating auto-publishes a qualification round', () => {
  it('rate transaction ends at PUBLISHED with the results hash and audit RATED then PUBLISHED', async () => {
    const database = new FakeRoundDatabase();
    const result = await reconcile(database);

    const expectedHash = await computeRoundResultsHash(asDb(database), 'schedule-1');
    expect(result.status).toBe('PUBLISHED');
    expect(database.round.results_hash).toBe(expectedHash);
    expect(database.round.results_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.resultsHash).toBe(expectedHash);
    expect(database.round.published_at).toBeInstanceOf(Date);
    expect(database.audits.map(({ action }) => action)).toEqual(['ROUND_RATED', 'ROUND_PUBLISHED']);
    expect(database.audits[1]).toMatchObject({ reason: 'auto-published after rating', details: { resultsHash: expectedHash } });
  });

  it('the next round can be created right after rating', async () => {
    const database = new FakeRoundDatabase();
    await reconcile(database);
    const next = await createRound(asDb(database), { tournamentStage: STAGE, reason: 'next', actorAccountId: 'acc-1' });
    expect(next).toMatchObject({ status: 'DRAFT_RULES', roundNumber: 2 });
  });

  it('a legacy RATED round is published by the next check, once', async () => {
    const database = new FakeRoundDatabase(baseRound({ status: 'RATED' }));
    const first = await reconcile(database, 'check results');
    expect(first.status).toBe('PUBLISHED');
    expect(database.audits.map(({ action }) => action)).toEqual(['ROUND_PUBLISHED']);
    const hash = database.round.results_hash;

    const second = await reconcile(database, 'check again');
    expect(second.status).toBe('PUBLISHED');
    expect(database.audits.map(({ action }) => action)).toEqual(['ROUND_PUBLISHED']);
    expect(database.round.results_hash).toBe(hash);
  });

  it('legacy RATED round can still be published with the publish action', async () => {
    const database = new FakeRoundDatabase(baseRound({ status: 'RATED' }));
    const result = await executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'publish' }, reason: 'publish results', actorAccountId: 'acc-1' });
    expect(result.status).toBe('PUBLISHED');
    expect(database.audits).toMatchObject([{ action: 'ROUND_PUBLISHED', reason: 'publish results' }]);
  });

  it('publish on a PUBLISHED round is a replayed no-op', async () => {
    const database = new FakeRoundDatabase();
    await reconcile(database);
    const auditsBefore = database.audits.length;
    const hash = database.round.results_hash;
    const result = await executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'publish' }, reason: 'again', actorAccountId: 'acc-1' });
    expect(result).toMatchObject({ status: 'PUBLISHED', replayed: true });
    expect(database.audits).toHaveLength(auditsBefore);
    expect(database.round.results_hash).toBe(hash);
  });

  it.each(['DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED', 'RUNNING', 'SETTLING', 'CANCELLED'])('publish on %s is ROUND_TRANSITION_INVALID', async (status) => {
    const database = new FakeRoundDatabase(baseRound({ status }));
    await expect(executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'publish' }, reason: 'too early', actorAccountId: 'acc-1' })).rejects.toThrow('ROUND_TRANSITION_INVALID');
    expect(database.audits).toEqual([]);
  });

  it('keeps publish in the transition table for RATED only, but the UI is offered reconcile instead', () => {
    expect(ALLOWED_TRANSITIONS.RATED).toEqual(['publish']);
    expect(getAllowedActions('RATED', null)).toEqual(['reconcile']);
    expect(getAllowedActions('PUBLISHED', null)).toEqual([]);
    expect(getAllowedActions('CANCELLED', null)).toEqual([]);
  });
});

describe('loop 101 part B: cancel a round before start', () => {
  it.each(['DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED'])('cancels from %s with audit and reason', async (status) => {
    const database = new FakeRoundDatabase(baseRound({ status, schedule_round_id: null }));
    const result = await executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'cancel' }, reason: '  mở nhầm vòng  ', actorAccountId: 'acc-1' }, { now: () => new Date('2026-10-20T00:00:00.000Z') });
    expect(result.status).toBe('CANCELLED');
    expect(result.allowedActions).toEqual([]);
    expect(database.round.cancel_reason).toBe('mở nhầm vòng');
    expect(database.round.cancelled_at).toEqual(new Date('2026-10-20T00:00:00.000Z'));
    expect(database.audits).toEqual([{ action: 'ROUND_CANCELLED', reason: 'mở nhầm vòng', details: { previousStatus: status } }]);
  });

  it.each(['RUNNING', 'SETTLING', 'RATED', 'PUBLISHED', 'CANCELLED'])('refuses to cancel from %s with ROUND_NOT_CANCELLABLE', async (status) => {
    const database = new FakeRoundDatabase(baseRound({ status }));
    await expect(executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'cancel' }, reason: 'too late', actorAccountId: 'acc-1' }))
      .rejects.toMatchObject({ message: 'ROUND_NOT_CANCELLABLE', details: { status } });
    expect(database.round.status).toBe(status);
    expect(database.audits).toEqual([]);
  });

  it('refuses to cancel once start was initiated (series may be being scheduled)', async () => {
    const database = new FakeRoundDatabase(baseRound({ status: 'SUBMISSION_CLOSED', schedule_round_id: null, start_idempotency_key: 'k', start_request_hash: 'a'.repeat(64) }));
    await expect(executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'cancel' }, reason: 'too late', actorAccountId: 'acc-1' }))
      .rejects.toMatchObject({ message: 'ROUND_NOT_CANCELLABLE' });
  });

  it.each(['', '  ', 'ab', ' a '])('rejects reason %j as INVALID_REASON', async (reason) => {
    const database = new FakeRoundDatabase(baseRound({ status: 'DRAFT_RULES' }));
    await expect(executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'cancel' }, reason, actorAccountId: 'acc-1' })).rejects.toThrow('INVALID_REASON');
    expect(database.round.status).toBe('DRAFT_RULES');
  });

  it('unknown round is ROUND_NOT_FOUND', async () => {
    const database = new FakeRoundDatabase();
    await expect(executeTransition(asDb(database), { roundId: 'missing', action: { type: 'cancel' }, reason: 'whatever', actorAccountId: 'acc-1' })).rejects.toThrow('ROUND_NOT_FOUND');
  });

  it('a cancelled round does not block creating a new round; numbers are not reused', async () => {
    const database = new FakeRoundDatabase(baseRound({ status: 'SUBMISSION_OPEN', schedule_round_id: null }));
    await expect(createRound(asDb(database), { tournamentStage: STAGE, reason: 'x', actorAccountId: 'acc-1' })).rejects.toThrow('ROUND_ALREADY_EXISTS_IN_STAGE');
    await executeTransition(asDb(database), { roundId: ROUND_ID, action: { type: 'cancel' }, reason: 'mở nhầm', actorAccountId: 'acc-1' });
    const next = await createRound(asDb(database), { tournamentStage: STAGE, reason: 'again', actorAccountId: 'acc-1' });
    expect(next).toMatchObject({ roundNumber: 2, status: 'DRAFT_RULES' });
  });

  it('transition table: cancel only before start, CANCELLED is terminal', () => {
    const cancellable = (Object.keys(ALLOWED_TRANSITIONS) as RoundStatus[]).filter((status) => ALLOWED_TRANSITIONS[status].includes('cancel'));
    expect(cancellable).toEqual(['DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED']);
    expect(ALLOWED_TRANSITIONS.CANCELLED).toEqual([]);
    expect(getAllowedActions('SUBMISSION_OPEN', null)).toEqual(['close', 'cancel']);
  });
});

const editorial: PublicEditorial = { announcements: [], faq: [], status: { message: 'Open', incidentEta: null }, changelog: 'c', minimumSeries: 5 };

function snapshotRules(): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1', engineVersion: '1.0.0', mapSet: [{ mapId: 'map-v1', checksum: 'a'.repeat(64) }], maxTurns: 200, faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: { startupMs: 5000, totalBotBudgetMs: 60000, matchWallClockMs: 150000, perTurn: { mode: 'FIXED', fixedMs: 1000 } },
    resources: { memoryMiB: 256, milliCpu: 1000, pids: 64, tmpfsMiB: 64, archiveMiB: 512, unpackedMiB: 1024, maxLayers: 20 },
    schedule: { submissionOpensAt: '2026-10-14T00:00:00Z', submissionDeadlineAt: '2026-10-15T00:00:00Z', graceEndsAt: '2026-10-15T12:00:00Z', runStartsAt: '2026-10-16T00:00:00Z', runMaxHours: 48, appealEndsAt: '2026-10-19T00:00:00Z' },
    testRun: { quotaPerTeamPerDay: 2, opponents: ['BTC_REFERENCE'] },
  };
}

/** Applies the status exclusion list found in the collector SQL to a fixed set of rounds (latest first). */
function snapshotDatabase(rounds: readonly { round_number: number; status: string }[]): Database {
  const rules = snapshotRules();
  const tx = {
    query: async (sql: string) => {
      if (sql.includes('FROM qualification_rounds q')) {
        const excluded = [...(/q\.status NOT IN \(([^)]*)\)/.exec(sql)?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
        const rows = rounds.filter((row) => !excluded.includes(row.status)).sort((a, b) => b.round_number - a.round_number)
          .map((row) => ({ ...row, schedule_round_id: null, version: 1, rules, rules_sha256: computeRulesSha256(rules) }));
        return { rows: rows.slice(0, 1) };
      }
      return { rows: [] };
    },
  };
  return { transaction: async (work: (t: unknown) => Promise<unknown>) => work(tx) } as unknown as Database;
}

describe('loop 101 part B: public snapshot skips cancelled rounds', () => {
  it('uses the latest non-draft, non-cancelled round', async () => {
    const snapshot = await collectQualificationSnapshot(snapshotDatabase([
      { round_number: 1, status: 'PUBLISHED' }, { round_number: 2, status: 'CANCELLED' },
    ]), editorial, []);
    expect(snapshot.round).toEqual({ name: 'Round 1', status: 'PUBLISHED' });
  });

  it('keeps the existing "no valid announced rules" behaviour when only draft/cancelled rounds exist', async () => {
    await expect(collectQualificationSnapshot(snapshotDatabase([
      { round_number: 1, status: 'CANCELLED' }, { round_number: 2, status: 'DRAFT_RULES' },
    ]), editorial, [])).rejects.toMatchObject({ reason: 'NO_ROUND' });
  });
});
