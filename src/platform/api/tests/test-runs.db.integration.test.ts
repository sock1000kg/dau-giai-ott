import { randomUUID } from 'node:crypto';
import { DEFAULT_MAP } from '@ott/game-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { createTestRun, getTestRunById } from '../src/modules/test-runs/service.ts';
import { computeRulesSha256 } from '../src/modules/rounds/types.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('test-run real PostgreSQL integration (FOR SHARE OF qr guard)', () => {
  let database: Database;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const adminId = randomUUID();
  const teamId = randomUUID();
  const accountId = randomUUID();
  const submissionId = randomUUID();
  const refBotId = `btc-ref-${suffix}`;
  let roundId: string;
  let ruleSetId: string;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);

    // Clean any leftover state from prior runs
    await database.query(
      'TRUNCATE accounts, teams, submissions, test_runs, test_run_outbox, test_run_reference_bots, qualification_rounds, round_rule_sets CASCADE',
    );

    // 1. Seed BTC admin account (required by round_rule_sets.created_by FK)
    await database.query(
      `INSERT INTO accounts (id, username, password_hash, role)
       VALUES ($1, $2, 'dummy-hash', 'BTC_ADMIN')`,
      [adminId, `admin-${suffix}`],
    );

    // 2. Seed test team (matches teams schema: id, name, representative_email)
    await database.query(
      `INSERT INTO teams (id, name, representative_email)
       VALUES ($1, $2, $3)`,
      [teamId, `team-${suffix}`, `team-${suffix}@example.com`],
    );

    // 3. Seed team account
    await database.query(
      `INSERT INTO accounts (id, username, password_hash, role, team_id)
       VALUES ($1, $2, 'dummy-hash', 'TEAM_ACCOUNT', $3)`,
      [accountId, `user-${suffix}`, teamId],
    );

    // 4. Seed team active submission
    await database.query(
      `INSERT INTO submissions (id, team_id, status, object_key, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, policy_version)
       VALUES ($1, $2, 'ACTIVE', $3, $4, $5, $6, $7, 'P2_BASELINE_V1')`,
      [
        submissionId,
        teamId,
        `submissions/${teamId}/${submissionId}.tar`,
        'sha256:' + 'a'.repeat(64),
        'sha256:' + 'b'.repeat(64),
        'sha256:' + 'c'.repeat(64),
        JSON.stringify(['/bot']),
      ],
    );

    // 5. Seed reference bot in test_run_reference_bots
    await database.query(
      `INSERT INTO test_run_reference_bots (id, display_name, object_key, archive_sha256, manifest_digest, config_digest, entrypoint, policy_version, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [
        refBotId,
        'BTC Reference Bot',
        `reference-bots/${refBotId}.tar`,
        'sha256:' + 'd'.repeat(64),
        'sha256:' + 'e'.repeat(64),
        'sha256:' + 'f'.repeat(64),
        JSON.stringify(['/ref-bot']),
        'P2_BASELINE_V1',
      ],
    );

    // 6. Seed rule set with default map and testRun opponents ['OWN_SUBMISSION', 'BTC_REFERENCE']
    const rules = {
      schemaVersion: 'ott.round-rules.v1' as const,
      engineVersion: '1.0.0',
      mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }],
      maxTurns: 200,
      faultPolicyVersion: 'P2_BASELINE_V1',
      timeControl: {
        startupMs: 5000,
        totalBotBudgetMs: 60000,
        matchWallClockMs: 150000,
        perTurn: { mode: 'FIXED' as const, fixedMs: 1000 },
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
        submissionOpensAt: '2026-10-14T00:00:00.000Z',
        submissionDeadlineAt: '2026-10-20T00:00:00.000Z',
        graceEndsAt: '2026-10-20T12:00:00.000Z',
        runStartsAt: '2026-10-21T00:00:00.000Z',
        runMaxHours: 48,
        appealEndsAt: '2026-10-24T00:00:00.000Z',
      },
      testRun: {
        quotaPerTeamPerDay: 5,
        opponents: ['OWN_SUBMISSION', 'BTC_REFERENCE'] as ('OWN_SUBMISSION' | 'BTC_REFERENCE')[],
      },
    };
    ruleSetId = randomUUID();
    const sha = computeRulesSha256(rules);
    const vRes = await database.query<{ next_version: string | number }>(
      `SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM round_rule_sets WHERE tournament_stage = 'QUALIFICATION'`,
    );
    const nextVersion = Number(vRes.rows[0]?.next_version ?? 1);
    await database.query(
      `INSERT INTO round_rule_sets (id, tournament_stage, version, rules, rules_sha256, created_by, reason)
       VALUES ($1, 'QUALIFICATION', $2, $3::jsonb, $4, $5, 'initial')`,
      [ruleSetId, nextVersion, JSON.stringify(rules), sha, adminId],
    );

    // 7. Seed open qualification round linked to rule set
    roundId = randomUUID();
    const rRes = await database.query<{ next_round: string | number }>(
      `SELECT COALESCE(MAX(round_number), 0) + 1 AS next_round FROM qualification_rounds WHERE tournament_stage = 'QUALIFICATION'`,
    );
    const nextRoundNumber = Number(rRes.rows[0]?.next_round ?? 1);
    await database.query(
      `INSERT INTO qualification_rounds (id, round_number, tournament_stage, status, rule_set_id)
       VALUES ($1, $2, 'QUALIFICATION', 'SUBMISSION_OPEN', $3)`,
      [roundId, nextRoundNumber, ruleSetId],
    );
  });

  afterAll(async () => {
    if (database) {
      await database.query(`DELETE FROM test_runs WHERE team_id = $1`, [teamId]);
      await database.query(`DELETE FROM test_run_reference_bots WHERE id = $1`, [refBotId]);
      await database.close();
    }
  });

  it('creates test run succeeds on real PostgreSQL with FOR SHARE OF qr and stores real map checksum', async () => {
    const run = await createTestRun(database, undefined, {
      teamId,
      submissionId,
      opponentType: 'BTC_REFERENCE',
      opponentReferenceBot: refBotId,
      roundId,
      mapId: DEFAULT_MAP.mapId,
      mapChecksum: DEFAULT_MAP.checksum,
      idempotencyKey: `db-run-explicit-round-${suffix}`,
    });

    expect(run.id).toBeTruthy();
    expect(run.status).toBe('QUEUED');
    expect(run.opponentType).toBe('BTC_REFERENCE');
    expect(run.opponentReferenceBot).toBe(refBotId);
    expect(run.mapChecksum).toBe(DEFAULT_MAP.checksum);

    const fetched = await getTestRunById(database, run.id, { role: 'TEAM_ACCOUNT', teamId });
    expect(fetched.id).toBe(run.id);
  });

  it('creates test run with self-play (opponentSubmissionId === submissionId) resolving latest open round', async () => {
    const run = await createTestRun(database, undefined, {
      teamId,
      submissionId,
      opponentType: 'OWN_SUBMISSION',
      opponentSubmissionId: submissionId, // self-play
      idempotencyKey: `db-run-implicit-round-${suffix}`,
    });

    expect(run.id).toBeTruthy();
    expect(run.roundId).toBe(roundId);
    expect(run.opponentType).toBe('OWN_SUBMISSION');
    expect(run.opponentSubmissionId).toBe(submissionId);
    expect(run.mapChecksum).toBe(DEFAULT_MAP.checksum);
  });
});
