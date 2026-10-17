import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export interface Migration {
  readonly id: string;
  readonly checksum: string;
  readonly sql: string;
}

export const migrationFiles = [
  { id: '0001_initial', source: new URL('../../migrations/0001_initial.sql', import.meta.url) },
  { id: '0002_match_execution_finalization', source: new URL('../../migrations/0002_match_execution_finalization.sql', import.meta.url) },
  { id: '0003_round_scheduling', source: new URL('../../migrations/0003_round_scheduling.sql', import.meta.url) },
  { id: '0004_round_rating_application', source: new URL('../../migrations/0004_round_rating_application.sql', import.meta.url) },
  { id: '0005_match_fault_summary', source: new URL('../../migrations/0005_match_fault_summary.sql', import.meta.url) },
  { id: '0006_replay_publication', source: new URL('../../migrations/0006_replay_publication.sql', import.meta.url) },
  { id: '0007_round_rules', source: new URL('../../migrations/0007_round_rules.sql', import.meta.url) },
  { id: '0008_team_representative_email', source: new URL('../../migrations/0008_team_representative_email.sql', import.meta.url) },
  { id: '0009_submission_reservations', source: new URL('../../migrations/0009_submission_reservations.sql', import.meta.url) },
  { id: '0012_admin_mfa', source: new URL('../../migrations/0012_admin_mfa.sql', import.meta.url) },
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
