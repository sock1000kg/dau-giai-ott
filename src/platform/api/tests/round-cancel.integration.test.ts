import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';
import { createRound, executeTransition } from '../src/modules/rounds/service.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('loop 101 migration 0021: cancel a qualification round (PostgreSQL)', () => {
  let database: Database;
  const suffix = randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase();
  const stage = `CANCEL_${suffix}`;
  const accountId = randomUUID();

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query("INSERT INTO accounts (id, username, password_hash, role) VALUES ($1, $2, $3, 'BTC_ADMIN')", [accountId, `cancel-${suffix}`, 'hash']);
  });

  afterAll(async () => {
    // qualification_rounds rows cannot be deleted (trigger); the run-unique stage keeps them inert.
    await database.close();
  });

  it('cancels a DRAFT round, stores reason/time, frees the stage slot and does not reuse the number', async () => {
    const first = await createRound(database, { tournamentStage: stage, reason: 'first', actorAccountId: accountId });
    await expect(createRound(database, { tournamentStage: stage, reason: 'blocked', actorAccountId: accountId })).rejects.toThrow('ROUND_ALREADY_EXISTS_IN_STAGE');

    const cancelled = await executeTransition(database, { roundId: first.id, action: { type: 'cancel' }, reason: 'mở nhầm vòng', actorAccountId: accountId });
    expect(cancelled.status).toBe('CANCELLED');
    const row = await database.query<{ cancelled_at: Date | null; cancel_reason: string | null }>('SELECT cancelled_at, cancel_reason FROM qualification_rounds WHERE id = $1', [first.id]);
    expect(row.rows[0]?.cancel_reason).toBe('mở nhầm vòng');
    expect(row.rows[0]?.cancelled_at).toBeInstanceOf(Date);

    const second = await createRound(database, { tournamentStage: stage, reason: 'second', actorAccountId: accountId });
    expect(second.roundNumber).toBe(2);

    const audit = await database.query<{ details: { previousStatus: string } }>("SELECT details FROM audit_events WHERE target_id = $1 AND action = 'ROUND_CANCELLED'", [first.id]);
    expect(audit.rows[0]?.details.previousStatus).toBe('DRAFT_RULES');
  });

  it('DB trigger: CANCELLED is terminal and RUNNING/RATED cannot be cancelled by direct UPDATE', async () => {
    const id = randomUUID();
    const otherStage = `CANCEL_T_${suffix}`;
    await database.query("INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1,$2,1,'DRAFT_RULES')", [id, otherStage]);
    await database.query("UPDATE qualification_rounds SET status = 'CANCELLED' WHERE id = $1", [id]);
    await expect(database.query("UPDATE qualification_rounds SET status = 'DRAFT_RULES' WHERE id = $1", [id])).rejects.toMatchObject({ code: 'P0001' });
    await expect(database.query("UPDATE qualification_rounds SET status = 'SUBMISSION_OPEN' WHERE id = $1", [id])).rejects.toMatchObject({ code: 'P0001' });
  });

  it('service refuses a round past SUBMISSION_CLOSED', async () => {
    const id = randomUUID();
    const otherStage = `CANCEL_R_${suffix}`;
    await database.query("INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1,$2,1,'DRAFT_RULES')", [id, otherStage]);
    await expect(executeTransition(database, { roundId: id, action: { type: 'publish' }, reason: 'nope', actorAccountId: accountId })).rejects.toThrow('ROUND_TRANSITION_INVALID');
    await executeTransition(database, { roundId: id, action: { type: 'cancel' }, reason: 'dọn vòng thử', actorAccountId: accountId });
    await expect(executeTransition(database, { roundId: id, action: { type: 'cancel' }, reason: 'lần hai', actorAccountId: accountId })).rejects.toMatchObject({ message: 'ROUND_NOT_CANCELLABLE', details: { status: 'CANCELLED' } });
  });
});
