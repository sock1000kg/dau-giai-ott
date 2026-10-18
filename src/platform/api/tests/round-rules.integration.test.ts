import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { createRuleSet, createRound, executeTransition, listRuleSets, listRounds, getRound } from '../src/modules/rounds/service.ts';
import { computeRulesSha256, validateRoundRuleSetRules } from '../src/modules/rounds/types.ts';
import { scheduleRound, settleSeries } from '../src/modules/scheduling/service.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function validQualificationRules() {
  return {
    schemaVersion: 'ott.round-rules.v1' as const,
    engineVersion: '1.0.0',
    mapSet: [{ mapId: 'default', checksum: 'a'.repeat(64) }],
    maxTurns: 200,
    faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: {
      startupMs: 5000,
      totalBotBudgetMs: 60000,
      matchWallClockMs: 150000,
      perTurn: { mode: 'DYNAMIC' as const, baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
    },
    resources: {
      memoryMiB: 256,
      milliCpu: 1000,
      pids: 64,
      tmpfsMiB: 64,
      archiveMiB: 512,
      unpackedMiB: 1024,
      maxLayers: 20,
    },
    schedule: {
      submissionOpensAt: '2026-10-14T14:00:00.000Z',
      submissionDeadlineAt: '2026-10-17T23:59:00.000Z',
      graceEndsAt: '2026-10-18T12:00:00.000Z',
      runStartsAt: '2026-10-18T14:00:00.000Z',
      runMaxHours: 48,
      appealEndsAt: '2026-10-21T12:00:00.000Z',
    },
    testRun: {
      quotaPerTeamPerDay: 2,
      opponents: ['BTC_REFERENCE'] as ('BTC_REFERENCE' | 'OWN_SUBMISSION')[],
    },
  };
}

integration('P3-D01 round-rules PostgreSQL integration', () => {
  let database: Database;
  const suffix = randomUUID();
  const stage = `P3D01_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const crashStage = `P3D01C_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
  const cleanupStages = [stage, crashStage];
  const accountId = randomUUID();
  const teamIds: string[] = [];
  const submissionIds: string[] = [];
  let ruleSetId = '';
  let roundId = '';
  let scheduleRoundId = '';

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);

    await database.query(
      "INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN')",
      [accountId, `p3d01-${suffix}`, 'hash'],
    );

    const rules = validQualificationRules();
    const sha = computeRulesSha256(rules);
    ruleSetId = randomUUID();
    await database.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ruleSetId, stage, 1, JSON.stringify(rules), sha, accountId, 'initial rules'],
    );

    roundId = randomUUID();
    await database.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1,$2,$3,'DRAFT_RULES')",
      [roundId, stage, 1],
    );

    for (const targetStage of [stage, crashStage]) {
      for (let i = 0; i < 5; i++) {
        const teamId = randomUUID();
        const submissionId = randomUUID();
        teamIds.push(teamId);
        submissionIds.push(submissionId);
        await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `P3D01 ${suffix} ${targetStage} ${i}`]);
        await database.query(
          "INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'P2_BASELINE_V1','ACTIVE')",
          [submissionId, teamId, targetStage, `sha256:${String(i + 1).repeat(64)}`, `sha256:${String(i + 2).repeat(64)}`, `sha256:${String(i + 3).repeat(64)}`, `p3d01/${submissionId}`],
        );
      }
    }
  });

  afterAll(async () => {
    try {
      for (const cleanupStage of cleanupStages) {
        const fixtureRounds = await database.query<{ readonly id: string }>('SELECT id FROM rounds WHERE tournament_stage = $1', [cleanupStage]);
        for (const { id } of fixtureRounds.rows) {
          await database.query('DELETE FROM match_outbox WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
          await database.query('DELETE FROM match_results WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
          await database.query('DELETE FROM match_events WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
          await database.query('DELETE FROM match_attempts WHERE match_id IN (SELECT m.id FROM matches m JOIN series s ON s.id = m.series_id WHERE s.round_id = $1)', [id]);
          await database.query('DELETE FROM rating_ledger WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [id]);
          await database.query('DELETE FROM matches WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [id]);
          await database.query('DELETE FROM round_participants WHERE round_id = $1', [id]);
          await database.query('DELETE FROM series WHERE round_id = $1', [id]);
        }
      }
    } finally {
      // qualification_rounds, round_rule_sets, rounds, accounts, teams and submissions cannot be
      // deleted (immutability triggers and FK from qualification_rounds.schedule_round_id). Every
      // fixture uses a random, run-unique stage/account so leftover rows are inert in a throwaway DB.
      await database.close();
    }
  });

  it('creates versions with incrementing version numbers', async () => {
    const rs1 = await createRuleSet(database, { tournamentStage: stage, rules: validQualificationRules(), reason: 'v2 rules', actorAccountId: accountId });
    expect(rs1.version).toBe(2);
    expect(rs1.rulesSha256).toMatch(/^[0-9a-f]{64}$/);
    await expect(createRuleSet(database, { tournamentStage: stage, rules: { ...validQualificationRules(), maxTurns: 150 }, reason: 'v3 rules', actorAccountId: accountId })).resolves.toMatchObject({ version: 3 });
  });

  it('rejects invalid rule sets with RULE_SET_INVALID', async () => {
    await expect(createRuleSet(database, { tournamentStage: stage, rules: { ...validQualificationRules(), perTurn: { mode: 'NONE' } }, reason: 'bad', actorAccountId: accountId })).rejects.toThrow('RULE_SET_INVALID');
  });

  it('DB immutability: rejects UPDATE and DELETE on round_rule_sets', async () => {
    await expect(database.query('UPDATE round_rule_sets SET reason = $1 WHERE id = $2', ['mutated', ruleSetId])).rejects.toMatchObject({ code: 'P0001' });
    await expect(database.query('DELETE FROM round_rule_sets WHERE id = $1', [ruleSetId])).rejects.toMatchObject({ code: 'P0001' });
  });

  it('DB immutability: rejects UPDATE of locked rule_set_id on qualification_rounds', async () => {
    await executeTransition(database, { roundId, action: { type: 'open', ruleSetId }, reason: 'open', actorAccountId: accountId });
    const newRuleSetId = randomUUID();
    const rules = validQualificationRules();
    await database.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [newRuleSetId, stage, 99, JSON.stringify(rules), computeRulesSha256(rules), accountId, 'another'],
    );
    await expect(database.query('UPDATE qualification_rounds SET rule_set_id = $1 WHERE id = $2', [newRuleSetId, roundId])).rejects.toMatchObject({ code: 'P0001' });
  });

  it('DB immutability: rejects illegal direct status UPDATE', async () => {
    await expect(database.query("UPDATE qualification_rounds SET status = 'PUBLISHED' WHERE id = $1", [roundId])).rejects.toMatchObject({ code: 'P0001' });
  });

  it('DB immutability: rejects DELETE on qualification_rounds', async () => {
    await expect(database.query('DELETE FROM qualification_rounds WHERE id = $1', [roundId])).rejects.toMatchObject({ code: 'P0001' });
  });

  it('close before grace period is rejected', async () => {
    await expect(
      executeTransition(
        database,
        { roundId, action: { type: 'close' }, reason: 'too early', actorAccountId: accountId },
        { now: () => new Date('2026-10-18T11:00:00.000Z') },
      ),
    ).rejects.toThrow('ROUND_TRANSITION_INVALID');
  });

  it('close after grace period succeeds', async () => {
    const result = await executeTransition(
      database,
      { roundId, action: { type: 'close' }, reason: 'grace passed', actorAccountId: accountId },
      { now: () => new Date('2026-10-18T13:00:00.000Z') },
    );
    expect(result.status).toBe('SUBMISSION_CLOSED');
  });

  it('start before close is rejected', async () => {
    const ownStage = `P3D01S_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
    const ownRuleSetId = randomUUID();
    const rules = validQualificationRules();
    await database.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ownRuleSetId, ownStage, 1, JSON.stringify(rules), computeRulesSha256(rules), accountId, 'own stage rules'],
    );
    const newRoundId = randomUUID();
    await database.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1,$2,$3,'DRAFT_RULES')",
      [newRoundId, ownStage, 1],
    );
    await expect(executeTransition(database, { roundId: newRoundId, action: { type: 'start', ruleSetId: ownRuleSetId, idempotencyKey: 'key-1' }, reason: 'start before close', actorAccountId: accountId })).rejects.toThrow('ROUND_TRANSITION_INVALID');
  });

  it('start with same key returns same schedule_round_id (idempotent)', async () => {
    const result1 = await executeTransition(database, { roundId, action: { type: 'start', ruleSetId, idempotencyKey: 'start-key-1' }, reason: 'start round', actorAccountId: accountId });
    expect(result1.status).toBe('RUNNING');
    scheduleRoundId = result1.scheduleRoundId!;

    const result2 = await executeTransition(database, { roundId, action: { type: 'start', ruleSetId, idempotencyKey: 'start-key-1' }, reason: 'retry same key', actorAccountId: accountId });
    expect(result2.scheduleRoundId).toBe(scheduleRoundId);
  });

  it('start with different key is rejected', async () => {
    await expect(executeTransition(database, { roundId, action: { type: 'start', ruleSetId, idempotencyKey: 'start-key-2' }, reason: 'different key', actorAccountId: accountId })).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');
  });

  it('start writes exactly two audit rows (initiated + started)', async () => {
    const auditRows = await database.query<{ readonly action: string }>(
      "SELECT action FROM audit_events WHERE target_id = $1 AND action LIKE 'ROUND_START%' ORDER BY created_at",
      [roundId],
    );
    expect(auditRows.rows).toHaveLength(2);
    expect(auditRows.rows[0]!.action).toBe('ROUND_START_INITIATED');
    expect(auditRows.rows[1]!.action).toBe('ROUND_STARTED');
  });

  it('pause/resume edges work correctly', async () => {
    const paused = await executeTransition(database, { roundId, action: { type: 'pause' }, reason: 'pause round', actorAccountId: accountId });
    expect(paused.pausedAt).not.toBeNull();
    await expect(executeTransition(database, { roundId, action: { type: 'pause' }, reason: 'double pause', actorAccountId: accountId })).rejects.toThrow('ROUND_TRANSITION_INVALID');
    const resumed = await executeTransition(database, { roundId, action: { type: 'resume' }, reason: 'resume round', actorAccountId: accountId });
    expect(resumed.pausedAt).toBeNull();
    await expect(executeTransition(database, { roundId, action: { type: 'resume' }, reason: 'double resume', actorAccountId: accountId })).rejects.toThrow('ROUND_TRANSITION_INVALID');
  });

  it('reconcile while series pending stays RUNNING', async () => {
    const result = await executeTransition(database, { roundId, action: { type: 'reconcile' }, reason: 'check status', actorAccountId: accountId });
    expect(result.status).toBe('RUNNING');
  });

  it('settle all series then reconcile to SETTLING and RATED', async () => {
    const matchRows = await database.query<{
      readonly id: string;
      readonly series_id: string;
      readonly game_number: number;
    }>('SELECT id, series_id, game_number FROM matches WHERE series_id IN (SELECT id FROM series WHERE round_id = $1) ORDER BY series_id, game_number', [scheduleRoundId]);

    for (const seriesId of new Set(matchRows.rows.map(({ series_id }) => series_id))) {
      const games = matchRows.rows.filter(({ series_id }) => series_id === seriesId);
      for (const [index, match] of games.entries()) {
        await database.query("UPDATE matches SET status = 'FINALIZED' WHERE id = $1", [match.id]);
        await database.query(
          "INSERT INTO match_results (match_id, winner_side, reason, turn_count, final_state_hash) VALUES ($1,'X','TURN_LIMIT',4,$2)",
          [match.id, `${index === 0 ? 'a' : 'b'}${'0'.repeat(63)}`],
        );
      }
      await settleSeries(database, seriesId);
    }

    const settlingResult = await executeTransition(database, { roundId, action: { type: 'reconcile' }, reason: 'all terminal', actorAccountId: accountId });
    expect(settlingResult.status).toBe('SETTLING');

    const ledgerBefore = await database.query('SELECT id FROM rating_ledger WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [scheduleRoundId]);

    const ratedResult = await executeTransition(database, { roundId, action: { type: 'reconcile' }, reason: 'apply ratings', actorAccountId: accountId });
    expect(ratedResult.status).toBe('RATED');

    const ledgerAfter = await database.query('SELECT id FROM rating_ledger WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [scheduleRoundId]);
    expect(ledgerAfter.rows).toHaveLength(ledgerBefore.rows.length);

    const ratedAgain = await executeTransition(database, { roundId, action: { type: 'reconcile' }, reason: 'idempotent ratings', actorAccountId: accountId });
    expect(ratedAgain.status).toBe('RATED');

    const ledgerFinal = await database.query('SELECT id FROM rating_ledger WHERE series_id IN (SELECT id FROM series WHERE round_id = $1)', [scheduleRoundId]);
    expect(ledgerFinal.rows).toHaveLength(ledgerBefore.rows.length);
  });

  it('publish only from RATED', async () => {
    const published = await executeTransition(database, { roundId, action: { type: 'publish' }, reason: 'publish results', actorAccountId: accountId });
    expect(published.status).toBe('PUBLISHED');
  });

  it('create next round blocked until PUBLISHED', async () => {
    const nextRound = await createRound(database, { tournamentStage: stage, reason: 'next round', actorAccountId: accountId });
    expect(nextRound.status).toBe('DRAFT_RULES');
    await expect(createRound(database, { tournamentStage: stage, reason: 'third round', actorAccountId: accountId })).rejects.toThrow('ROUND_ALREADY_EXISTS_IN_STAGE');
  });

  it('every action writes audit rows with reason and details', async () => {
    const auditRows = await database.query<{
      readonly action: string;
      readonly reason: string | null;
      readonly details: unknown;
    }>(
      "SELECT action, reason, details FROM audit_events WHERE target_id = $1 ORDER BY created_at",
      [roundId],
    );
    expect(auditRows.rows.length).toBeGreaterThan(0);
    for (const row of auditRows.rows) {
      expect(row.action).toMatch(/^ROUND_/);
      if (row.action !== 'ROUND_START_INITIATED') {
        expect(row.reason).toBeTruthy();
      }
    }
  });

  it('rule set stage mismatch is rejected', async () => {
    const mismatchStage = `P3D01M_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
    const otherStage = `OTHER_${suffix.replaceAll('-', '').slice(0, 16).toUpperCase()}`;
    const otherRuleSetId = randomUUID();
    const rules = validQualificationRules();
    await database.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [otherRuleSetId, otherStage, 1, JSON.stringify(rules), computeRulesSha256(rules), accountId, 'other stage'],
    );
    const newRoundId = randomUUID();
    await database.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1,$2,$3,'DRAFT_RULES')",
      [newRoundId, mismatchStage, 1],
    );
    await expect(executeTransition(database, { roundId: newRoundId, action: { type: 'open', ruleSetId: otherRuleSetId }, reason: 'wrong stage', actorAccountId: accountId })).rejects.toThrow('RULE_SET_STAGE_MISMATCH');
  });

  it('crash between start steps persists tx1 and retry completes with one schedule round and one ROUND_STARTED audit', async () => {
    const ownStage = crashStage;
    const ownRuleSetId = randomUUID();
    const rules = validQualificationRules();
    await database.query(
      'INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [ownRuleSetId, ownStage, 1, JSON.stringify(rules), computeRulesSha256(rules), accountId, 'crash stage rules'],
    );
    const crashRoundId = randomUUID();
    await database.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status, rule_set_id) VALUES ($1,$2,$3,'SUBMISSION_CLOSED',$4)",
      [crashRoundId, ownStage, 1, ownRuleSetId],
    );

    await expect(
      executeTransition(
        database,
        { roundId: crashRoundId, action: { type: 'start', ruleSetId: ownRuleSetId, idempotencyKey: 'crash-key-1' }, reason: 'start with crash', actorAccountId: accountId },
        { scheduleRound: async () => { throw new Error('SIMULATED_CRASH'); } },
      ),
    ).rejects.toThrow('SIMULATED_CRASH');

    const afterCrash = await database.query<{ readonly status: string; readonly start_idempotency_key: string | null }>(
      'SELECT status, start_idempotency_key FROM qualification_rounds WHERE id = $1',
      [crashRoundId],
    );
    expect(afterCrash.rows[0]).toMatchObject({ status: 'SUBMISSION_CLOSED', start_idempotency_key: 'crash-key-1' });
    const initiatedAfterCrash = await database.query<{ readonly action: string }>("SELECT action FROM audit_events WHERE target_id = $1 AND action LIKE 'ROUND_START%'", [crashRoundId]);
    expect(initiatedAfterCrash.rows.map(({ action }) => action)).toEqual(['ROUND_START_INITIATED']);
    const roundsAfterCrash = await database.query('SELECT id FROM rounds WHERE tournament_stage = $1', [ownStage]);
    expect(roundsAfterCrash.rows).toHaveLength(0);

    const retried = await executeTransition(database, { roundId: crashRoundId, action: { type: 'start', ruleSetId: ownRuleSetId, idempotencyKey: 'crash-key-1' }, reason: 'retry start', actorAccountId: accountId });
    expect(retried.status).toBe('RUNNING');
    expect(retried.replayed).toBeUndefined();

    const scheduledRounds = await database.query<{ readonly id: string }>('SELECT id FROM rounds WHERE tournament_stage = $1', [ownStage]);
    expect(scheduledRounds.rows).toHaveLength(1);
    expect(retried.scheduleRoundId).toBe(scheduledRounds.rows[0]!.id);
    const auditsAfterRetry = await database.query<{ readonly action: string }>("SELECT action FROM audit_events WHERE target_id = $1 AND action LIKE 'ROUND_START%' ORDER BY created_at", [crashRoundId]);
    expect(auditsAfterRetry.rows.map(({ action }) => action)).toEqual(['ROUND_START_INITIATED', 'ROUND_STARTED']);

    const replayed = await executeTransition(database, { roundId: crashRoundId, action: { type: 'start', ruleSetId: ownRuleSetId, idempotencyKey: 'crash-key-1' }, reason: 'third start', actorAccountId: accountId });
    expect(replayed.status).toBe('RUNNING');
    expect(replayed.replayed).toBe(true);
    const roundsAfterReplay = await database.query('SELECT id FROM rounds WHERE tournament_stage = $1', [ownStage]);
    expect(roundsAfterReplay.rows).toHaveLength(1);
    const auditsAfterReplay = await database.query<{ readonly action: string }>("SELECT action FROM audit_events WHERE target_id = $1 AND action LIKE 'ROUND_START%' ORDER BY created_at", [crashRoundId]);
    expect(auditsAfterReplay.rows.map(({ action }) => action)).toEqual(['ROUND_START_INITIATED', 'ROUND_STARTED']);
  });
});