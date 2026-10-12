import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface Migration {
  readonly id: string;
  readonly checksum: string;
  readonly sql: string;
}

const migrationFiles = [
  { id: '0001_initial', source: new URL('../../migrations/0001_initial.sql', import.meta.url) },
  { id: '0002_match_execution_finalization', source: new URL('../../migrations/0002_match_execution_finalization.sql', import.meta.url) },
  { id: '0003_round_scheduling', source: new URL('../../migrations/0003_round_scheduling.sql', import.meta.url) },
] as const;

export async function loadMigrations(): Promise<readonly Migration[]> {
  return Promise.all(migrationFiles.map(async ({ id, source }) => {
    const sql = await readFile(source, 'utf8');
    return {
      id,
      sql,
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  }));
}
