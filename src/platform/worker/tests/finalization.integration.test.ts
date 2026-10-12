import { createHash, randomUUID } from 'node:crypto';
import type { MatchJobV1, OciArtifactReference } from '@ott/job-contract';
import { DEFAULT_LIMITS, type InitMessage, type MatchResultMessage, type StateUpdateMessage, type TurnResultMessage } from '@ott/bot-protocol';
import { DEFAULT_MAP } from '@ott/game-core';
import type { BotPort, BotStartResult } from '@ott/match-runner';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, runMigrations, type Database, type ObjectStorage } from '@ott/platform-api';
import { runMatchJob } from '../src/run-match-job.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;
const POLICY_VERSION = 'P2_BASELINE_V1';
const archiveX = Buffer.from('fixture-x');
const archiveO = Buffer.from('fixture-o');
const checksum = (bytes: Uint8Array) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

class MemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, Uint8Array>();
  async put(key: string, value: Uint8Array): Promise<void> { this.objects.set(key, Uint8Array.from(value)); }
  async get(key: string): Promise<Uint8Array> {
    const value = this.objects.get(key);
    if (value === undefined) throw new Error('OBJECT_NOT_FOUND');
    return Uint8Array.from(value);
  }
  async copy(source: string, destination: string): Promise<void> {
    const value = await this.get(source);
    this.objects.set(destination, value);
  }
  async remove(key: string): Promise<void> { this.objects.delete(key); }
}

class FirstLegalBot implements BotPort {
  private init?: InitMessage;
  async start(init: InitMessage): Promise<BotStartResult> { this.init = init; return { ok: true }; }
  async requestAction(update: StateUpdateMessage) {
    const action = update.legalActions[0];
    if (action === undefined || this.init === undefined) return { ok: false as const, code: 'BOT_CRASHED' as const };
    return { ok: true as const, message: { type: 'ACTION' as const, protocolVersion: 1 as const, matchId: this.init.matchId, turnId: update.turnId, action } };
  }
  async notifyStateUpdate(_update: StateUpdateMessage): Promise<void> {}
  async sendTurnResult(_message: TurnResultMessage): Promise<void> {}
  async finish(_message: MatchResultMessage): Promise<void> {}
  async stop(): Promise<void> {}
}

class StartupFailureBot extends FirstLegalBot {
  async start(_init: InitMessage) { return { ok: false as const, code: 'BOT_CRASHED' as const }; }
}

integration('P2-T11 worker match finalization', () => {
  let database: Database;
  const created: Array<{ matchId: string; seriesId: string; teams: string[]; submissions: string[] }> = [];

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
  });

  afterAll(async () => {
    for (const item of created) {
      await database.query('DELETE FROM match_outbox WHERE match_id = $1', [item.matchId]);
      await database.query('DELETE FROM match_results WHERE match_id = $1', [item.matchId]);
      await database.query('DELETE FROM match_events WHERE match_id = $1', [item.matchId]);
      await database.query('DELETE FROM match_attempts WHERE match_id = $1', [item.matchId]);
      await database.query('DELETE FROM matches WHERE id = $1', [item.matchId]);
      await database.query('DELETE FROM series WHERE id = $1', [item.seriesId]);
      await database.query('DELETE FROM submissions WHERE id = ANY($1::uuid[])', [item.submissions]);
      await database.query('DELETE FROM teams WHERE id = ANY($1::uuid[])', [item.teams]);
    }
    await database.close();
  });

  async function fixture(): Promise<{ job: MatchJobV1; storage: MemoryStorage; matchId: string }> {
    const matchId = randomUUID();
    const seriesId = randomUUID();
    const teamX = randomUUID();
    const teamO = randomUUID();
    const submissionX = randomUUID();
    const submissionO = randomUUID();
    const manifestX = `sha256:${'a'.repeat(64)}`;
    const manifestO = `sha256:${'b'.repeat(64)}`;
    const configX = `sha256:${'c'.repeat(64)}`;
    const configO = `sha256:${'d'.repeat(64)}`;
    const keyX = `submissions/${submissionX}`;
    const keyO = `submissions/${submissionO}`;
    const storage = new MemoryStorage();
    storage.objects.set(keyX, archiveX);
    storage.objects.set(keyO, archiveO);

    await database.query('INSERT INTO teams (id, name) VALUES ($1, $2), ($3, $4)', [teamX, `X-${matchId}`, teamO, `O-${matchId}`]);
    await database.query(
      "INSERT INTO submissions (id, team_id, archive_sha256, oci_manifest_digest, oci_config_digest, entrypoint, object_key, policy_version, status) VALUES ($1,$2,$3,$4,$5,'[\"/bot\"]'::jsonb,$6,$7,'ACTIVE'), ($8,$9,$10,$11,$12,'[\"/bot\"]'::jsonb,$13,$7,'ACTIVE')",
      [submissionX, teamX, checksum(archiveX), manifestX, configX, keyX, POLICY_VERSION, submissionO, teamO, checksum(archiveO), manifestO, configO, keyO],
    );
    await database.query('INSERT INTO series (id, tournament_stage) VALUES ($1, $2)', [seriesId, 'QUALIFICATION']);
    await database.query(
      "INSERT INTO matches (id, series_id, x_submission_id, o_submission_id, status, map_checksum, seed, policy_version, max_turns) VALUES ($1,$2,$3,$4,'SCHEDULED',$5,$6,$7,2)",
      [matchId, seriesId, submissionX, submissionO, DEFAULT_MAP.checksum, `seed-${matchId}`, POLICY_VERSION],
    );
    created.push({ matchId, seriesId, teams: [teamX, teamO], submissions: [submissionX, submissionO] });

    return {
      matchId,
      storage,
      job: {
        schemaVersion: 'ott.match-job.v1', matchId, idempotencyKey: matchId, policyVersion: POLICY_VERSION,
        x: { submissionId: submissionX, archiveSha256: checksum(archiveX), manifestDigest: manifestX, configDigest: configX, policyVersion: POLICY_VERSION },
        o: { submissionId: submissionO, archiveSha256: checksum(archiveO), manifestDigest: manifestO, configDigest: configO, policyVersion: POLICY_VERSION },
      },
    };
  }

  it('rejects a concurrent lease, commits one result/event/rating trigger, and deduplicates redelivery', async () => {
    const state = await fixture();
    const createdPorts: OciArtifactReference[] = [];
    let releaseFactory!: () => void;
    let factoryEntered!: () => void;
    const blockedFactory = new Promise<void>((resolve) => { releaseFactory = resolve; });
    const enteredFactory = new Promise<void>((resolve) => { factoryEntered = resolve; });
    const dependencies = {
      database,
      storage: state.storage,
      createBotPort: async (_archive: Uint8Array, reference: OciArtifactReference) => {
        createdPorts.push(reference);
        if (createdPorts.length === 1) {
          factoryEntered();
          await blockedFactory;
        }
        return new FirstLegalBot();
      },
    };

    const firstPromise = runMatchJob({ job: state.job, ...dependencies });
    await enteredFactory;
    await expect(runMatchJob({ job: state.job, ...dependencies })).rejects.toThrow('MATCH_LEASE_ACTIVE');
    releaseFactory();
    const first = await firstPromise;
    const retry = await runMatchJob({ job: state.job, ...dependencies });
    const result = await database.query<{ reason: string; turn_count: number; final_state_hash: string; event_log_key: string; event_log_sha256: string }>(
      'SELECT reason, turn_count, final_state_hash, event_log_key, event_log_sha256 FROM match_results WHERE match_id = $1', [state.matchId],
    );
    const events = await database.query<{ count: string }>('SELECT count(*)::text AS count FROM match_events WHERE match_id = $1', [state.matchId]);
    const outbox = await database.query<{ count: string }>("SELECT count(*)::text AS count FROM match_outbox WHERE match_id = $1 AND event_type = 'MATCH_FINALIZED'", [state.matchId]);
    const match = await database.query<{ status: string }>('SELECT status FROM matches WHERE id = $1', [state.matchId]);
    const row = result.rows[0]!;
    const logBytes = await state.storage.get(row.event_log_key);

    expect(first.outcome.reason).toBe('TURN_LIMIT');
    expect(retry).toMatchObject({ alreadyFinalized: true, outcome: first.outcome });
    expect(createdPorts).toHaveLength(2);
    expect(createdPorts.every((reference) => reference.policyVersion === 'OTT_SANDBOX_V1')).toBe(true);
    expect(row.final_state_hash).toBe(first.outcome.finalStateHash);
    expect(row.event_log_sha256).toBe(checksum(logBytes));
    expect(row.event_log_key).toContain(row.event_log_sha256);
    expect(Number(events.rows[0]!.count)).toBeGreaterThan(0);
    expect(Number(outbox.rows[0]!.count)).toBe(1);
    expect(match.rows[0]!.status).toBe('FINALIZED');
    await expect(runMatchJob({
      job: { ...state.job, x: { ...state.job.x, manifestDigest: `sha256:${'f'.repeat(64)}` } },
      ...dependencies,
    })).rejects.toThrow('MATCH_SUBMISSION_IDENTITY_MISMATCH');
  }, 30_000);

  it('does not finalize a corrupted archive, then succeeds on a clean retry', async () => {
    const state = await fixture();
    state.storage.objects.set(`submissions/${state.job.x.submissionId}`, Buffer.from('tampered'));
    let botFactoryCalls = 0;

    await expect(runMatchJob({
      job: state.job,
      database,
      storage: state.storage,
      createBotPort: async () => { botFactoryCalls += 1; return new FirstLegalBot(); },
    })).rejects.toThrow('SUBMISSION_ARCHIVE_CHECKSUM_MISMATCH');
    const result = await database.query('SELECT 1 FROM match_results WHERE match_id = $1', [state.matchId]);
    const attempt = await database.query<{ status: string }>('SELECT status FROM match_attempts WHERE match_id = $1', [state.matchId]);
    expect(result.rowCount).toBe(0);
    expect(attempt.rows[0]!.status).toBe('FAILED_RETRYABLE');
    expect(botFactoryCalls).toBe(0);

    state.storage.objects.set(`submissions/${state.job.x.submissionId}`, archiveX);
    const retry = await runMatchJob({
      job: state.job,
      database,
      storage: state.storage,
      attempt: { attemptNumber: 2, maxAttempts: 3 },
      createBotPort: async () => new FirstLegalBot(),
    });
    const attempts = await database.query<{ status: string }>('SELECT status FROM match_attempts WHERE match_id = $1 ORDER BY attempt_number', [state.matchId]);
    expect(retry.outcome.reason).toBe('TURN_LIMIT');
    expect(attempts.rows.map((row) => row.status)).toEqual(['FAILED_RETRYABLE', 'SUCCEEDED']);
  }, 30_000);

  it('records a bot startup crash as an official forfeit result, not an infrastructure retry', async () => {
    const state = await fixture();
    let factoryCalls = 0;
    const result = await runMatchJob({
      job: state.job,
      database,
      storage: state.storage,
      createBotPort: async () => factoryCalls++ === 0 ? new StartupFailureBot() : new FirstLegalBot(),
    });
    const persisted = await database.query<{ winner_side: string | null; reason: string; final_state_hash: string }>(
      'SELECT winner_side, reason, final_state_hash FROM match_results WHERE match_id = $1', [state.matchId],
    );
    const attempt = await database.query<{ status: string }>('SELECT status FROM match_attempts WHERE match_id = $1', [state.matchId]);

    expect(result.outcome).toMatchObject({ winnerSide: 'O', reason: 'FORFEIT', forfeitedSide: 'X', turnCount: 0 });
    expect(persisted.rows[0]).toMatchObject({ winner_side: 'O', reason: 'FORFEIT', final_state_hash: result.outcome.finalStateHash });
    expect(attempt.rows[0]!.status).toBe('SUCCEEDED');
  }, 30_000);

  it('rejects a queued artifact identity that differs from the database snapshot before starting bots', async () => {
    const state = await fixture();
    let factoryCalls = 0;

    await expect(runMatchJob({
      job: { ...state.job, x: { ...state.job.x, manifestDigest: `sha256:${'f'.repeat(64)}` } },
      database,
      storage: state.storage,
      createBotPort: async () => { factoryCalls += 1; return new FirstLegalBot(); },
    })).rejects.toThrow('MATCH_SUBMISSION_IDENTITY_MISMATCH');
    const match = await database.query<{ status: string }>('SELECT status FROM matches WHERE id = $1', [state.matchId]);
    expect(factoryCalls).toBe(0);
    expect(match.rows[0]!.status).toBe('SCHEDULED');
  }, 30_000);

  it('keeps the scheduled execution snapshot immutable', async () => {
    const state = await fixture();
    await expect(database.query('UPDATE matches SET seed = $1 WHERE id = $2', ['mutated-seed', state.matchId]))
      .rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining('match execution snapshot is immutable') });
    const snapshot = await database.query<{ seed: string }>('SELECT seed FROM matches WHERE id = $1', [state.matchId]);
    expect(snapshot.rows[0]!.seed).toBe(`seed-${state.matchId}`);
  }, 30_000);
});
