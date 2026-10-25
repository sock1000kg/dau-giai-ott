import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, runMigrations, type Database } from '../src/db/client.ts';

const databaseUrl = process.env.DATABASE_URL;
const integration = databaseUrl === undefined ? describe.skip : describe;

integration('submission/cancellation row-lock ordering (PostgreSQL)', () => {
  let database: Database;
  const roundId = randomUUID();
  const stage = `SUBLOCK_${randomUUID().replaceAll('-', '').slice(0, 16).toUpperCase()}`;

  beforeAll(async () => {
    database = createDatabase({ connectionString: databaseUrl! });
    await runMigrations(database);
    await database.query(
      "INSERT INTO qualification_rounds (id, tournament_stage, round_number, status) VALUES ($1, $2, 1, 'SUBMISSION_OPEN')",
      [roundId, stage],
    );
  });

  afterAll(async () => {
    await database.close();
  });

  it('serializes cancellation behind an upload reservation lock and then rejects later uploads', async () => {
    let signalLockAcquired!: () => void;
    let releaseUpload!: () => void;
    const lockAcquired = new Promise<void>((resolve) => { signalLockAcquired = resolve; });
    const keepUploadOpen = new Promise<void>((resolve) => { releaseUpload = resolve; });

    const uploadTransaction = database.transaction(async (tx) => {
      const result = await tx.query<{ readonly id: string }>(
        "SELECT id FROM qualification_rounds WHERE id = $1 AND status = 'SUBMISSION_OPEN' FOR SHARE",
        [roundId],
      );
      expect(result.rows).toHaveLength(1);
      signalLockAcquired();
      await keepUploadOpen;
    });

    await lockAcquired;
    let cancellationFinished = false;
    const cancellationTransaction = database.transaction(async (tx) => {
      await tx.query("UPDATE qualification_rounds SET status = 'CANCELLED' WHERE id = $1", [roundId]);
      cancellationFinished = true;
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 75));
      expect(cancellationFinished).toBe(false);
    } finally {
      releaseUpload();
    }

    await Promise.all([uploadTransaction, cancellationTransaction]);
    expect(cancellationFinished).toBe(true);

    const laterUpload = await database.transaction((tx) => tx.query(
      "SELECT id FROM qualification_rounds WHERE id = $1 AND status = 'SUBMISSION_OPEN' FOR SHARE",
      [roundId],
    ));
    expect(laterUpload.rows).toHaveLength(0);
  }, 10_000);
});
