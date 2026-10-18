import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import {
  closeLanCutoff,
  createFinalsCompetition,
  createFinalsRuleSet,
  FinalsRuleSetInvalidError,
  getFinalsCompetition,
  openLanSubmission,
  pinFinalsSubmission,
  seedFinalsCompetition,
} from '../src/modules/finals/service.ts';

/**
 * P3-D08 finals control plane integration tests (PostgreSQL required).
 *
 * Source of truth: docs/contracts/finals-format-v1.md, requirement 12/12.2 and D-22/D-24. The suite is
 * skipped when DATABASE_URL is unset so a service-less run stays green.
 */

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

function hash64(fill: string): string {
  return fill.repeat(64).slice(0, 64);
}

function finalsRules(bronze = true) {
  return {
    schemaVersion: 1,
    engineVersion: '1.0.0',
    maxTurns: 200,
    perTurn: { mode: 'DYNAMIC', baseMs: 1000, stepMs: 500, everyTurns: 40, maxMs: 3000 },
    pairingWallClockMs: 1_800_000,
    mapPool: ['default', 'arena', 'cross'],
    sidePolicy: 'SWAP_GAMES_1_2_SEEDED_GAME_3',
    gameAdapter: { adapterId: 'ott-game-adapter', adapterVersion: '1.0.0' },
    bronzeMatchEnabled: bronze,
  } as const;
}

integration('P3-D08 finals control plane (PostgreSQL)', () => {
  let database: Database;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
  const STAGE = `FINALS_INT_${suffix}`;
  const actorId = randomUUID();
  const teamIds = Array.from({ length: 8 }, () => randomUUID());
  const submissionIds = Array.from({ length: 8 }, () => randomUUID());

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1,$2,'x','BTC_ADMIN')", [
      actorId,
      `finals-int-${actorId.slice(0, 8)}`,
    ]);
    for (const [index, teamId] of teamIds.entries()) {
      await database.query('INSERT INTO teams (id, name) VALUES ($1,$2)', [teamId, `${STAGE} team ${index}`]);
      await database.query(
        `INSERT INTO submissions (id, team_id, tournament_stage, archive_sha256, oci_manifest_digest, oci_config_digest, object_key, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'ACTIVE')`,
        [
          submissionIds[index],
          teamId,
          STAGE,
          `sha256:${hash64('a')}`,
          `sha256:${hash64('b')}`,
          `sha256:${hash64('c')}`,
          `${STAGE}/submission-${index}`,
        ],
      );
    }
    // Four finalized series cover all eight teams: enough for minimumSeries = 1, not for the D-22 default.
    for (let index = 0; index < 8; index += 2) {
      await database.query(
        `INSERT INTO series (id, tournament_stage, status, team_a_id, team_b_id, team_a_score, team_b_score, finalized_at)
         VALUES ($1,$2,'FINALIZED',$3,$4,2,0,now())`,
        [randomUUID(), STAGE, teamIds[index], teamIds[index + 1]],
      );
    }
  });

  afterAll(async () => {
    if (database === undefined) return;
    try {
      await database.query('DELETE FROM series WHERE tournament_stage = $1', [STAGE]);
    } finally {
      // finals_competitions, finals_rule_sets, and finals_seeds are protected by immutability/append-only
      // triggers (reject_finals_competition_delete, reject_finals_rule_set_mutation, reject_finals_seed_mutation),
      // audit_events is append-only, and accounts, teams, and submissions are referenced by immutable seeds/pins.
      // Every fixture uses a run-unique stage and account ID so leftover rows remain inert in the DB.
      await database.close();
    }
  });

  it('rejects an invalid finals rule set before writing anything', async () => {
    await expect(
      createFinalsRuleSet(database, {
        tournamentStage: STAGE,
        rules: { ...finalsRules(), mapPool: ['default', 'default'] },
        reason: 'invalid rule set',
        actorAccountId: actorId,
      }),
    ).rejects.toBeInstanceOf(FinalsRuleSetInvalidError);
  });

  it('seeds exactly eight eligible teams, locks the ranking and refuses a second seeding', async () => {
    const ruleSet = await createFinalsRuleSet(database, {
      tournamentStage: STAGE,
      rules: finalsRules(),
      reason: 'finals rule set',
      actorAccountId: actorId,
    });
    const competition = await createFinalsCompetition(database, {
      tournamentStage: STAGE,
      ruleSetId: ruleSet.id,
      reason: 'finals competition',
      actorAccountId: actorId,
    });
    expect(competition.status).toBe('DRAFT_RULES');
    expect(competition.bronzeMatchEnabled).toBe(true);

    // The D-22 default threshold (five rated series) must refuse this stage: each team has one series.
    await expect(
      seedFinalsCompetition(database, {
        competitionId: competition.id,
        drawSeed: 'published-draw-seed',
        reason: 'default threshold',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow('FINALS_SEED_COUNT_INVALID');

    const seeded = await seedFinalsCompetition(database, {
      competitionId: competition.id,
      drawSeed: 'published-draw-seed',
      minimumSeries: 1,
      reason: 'seed finals',
      actorAccountId: actorId,
    });
    expect(seeded.seeds).toHaveLength(8);
    expect(seeded.seeds.map(({ ordinal }) => ordinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(seeded.excluded).toEqual([]);

    const detail = await getFinalsCompetition(database, competition.id);
    expect(detail?.seedingHash).toBe(seeded.seedingHash);
    expect(detail?.drawSeed).toBe('published-draw-seed');

    // The locked ranking is append-only: a second seeding is refused and rows cannot be rewritten.
    await expect(
      seedFinalsCompetition(database, {
        competitionId: competition.id,
        drawSeed: 'another-draw-seed',
        minimumSeries: 1,
        reason: 'reseed',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow('FINALS_ALREADY_SEEDED');
    await expect(
      database.query('UPDATE finals_seeds SET ordinal = 1 WHERE competition_id = $1', [competition.id]),
    ).rejects.toThrow(/finals_seed is immutable/);
  });

  it('closes the LAN cutoff idempotently, pins the rule set and freezes later pins', async () => {
    const competition = await database.query<{ readonly id: string; readonly rule_set_id: string }>(
      'SELECT id, rule_set_id FROM finals_competitions WHERE tournament_stage = $1',
      [STAGE],
    );
    const target = competition.rows[0]!;

    await openLanSubmission(database, {
      competitionId: target.id,
      submissionOpensAt: new Date('2026-10-20T08:00:00Z'),
      lanCutoffAt: new Date('2026-10-20T10:00:00Z'),
      reason: 'open LAN window',
      actorAccountId: actorId,
    });

    await pinFinalsSubmission(database, {
      competitionId: target.id,
      teamId: teamIds[0]!,
      submissionId: submissionIds[0]!,
      source: 'LAN',
      artifactSha256: hash64('d'),
      compatible: true,
      reason: 'LAN upload',
      actorAccountId: actorId,
    });
    // The qualification fallback is only for a team without a LAN pin.
    await expect(
      pinFinalsSubmission(database, {
        competitionId: target.id,
        teamId: teamIds[0]!,
        submissionId: submissionIds[1]!,
        source: 'QUALIFICATION_ACTIVE',
        artifactSha256: hash64('e'),
        compatible: true,
        reason: 'fallback',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow('FINALS_PIN_CONFLICT');
    // A pin that did not pass preflight compatibility is refused by the table trigger.
    await expect(
      pinFinalsSubmission(database, {
        competitionId: target.id,
        teamId: teamIds[1]!,
        submissionId: submissionIds[2]!,
        source: 'LAN',
        artifactSha256: hash64('f'),
        compatible: false,
        reason: 'incompatible',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow(/preflight compatibility/);

    const key = `cutoff-${target.id.slice(0, 8)}`;
    const first = await closeLanCutoff(database, {
      competitionId: target.id,
      idempotencyKey: key,
      requestHash: hash64('1'),
      reason: 'close cutoff',
      actorAccountId: actorId,
    });
    expect(first.replayed).toBe(false);
    expect(first.pinnedRuleSetId).toBe(target.rule_set_id);
    expect(first.pinnedMapPool).toEqual(['default', 'arena', 'cross']);

    const replay = await closeLanCutoff(database, {
      competitionId: target.id,
      idempotencyKey: key,
      requestHash: hash64('1'),
      reason: 'close cutoff again',
      actorAccountId: actorId,
    });
    expect(replay.replayed).toBe(true);
    expect(replay.pinnedMapPool).toEqual(first.pinnedMapPool);

    await expect(
      closeLanCutoff(database, {
        competitionId: target.id,
        idempotencyKey: key,
        requestHash: hash64('2'),
        reason: 'different request',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow('IDEMPOTENCY_KEY_REUSED');

    // After the cutoff the pinned submissions are frozen.
    await expect(
      pinFinalsSubmission(database, {
        competitionId: target.id,
        teamId: teamIds[2]!,
        submissionId: submissionIds[3]!,
        source: 'LAN',
        artifactSha256: hash64('9'),
        compatible: true,
        reason: 'late upload',
        actorAccountId: actorId,
      }),
    ).rejects.toThrow('FINALS_CUTOFF_CLOSED');

    const detail = await getFinalsCompetition(database, target.id);
    expect(detail?.status).toBe('SUBMISSION_CLOSED');
    expect(detail?.pinnedAt).not.toBeNull();
  });
});
