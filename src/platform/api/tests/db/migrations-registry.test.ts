import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { migrationFiles } from '../../src/db/schema.ts';

describe('migrations registry guard (DB-free)', () => {
  it('ensures migrationFiles has unique ids sorted ascending and each source exists', async () => {
    const ids = migrationFiles.map((m) => m.id);

    // 1. Ids must be unique
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    // 2. Ids must be sorted ascending
    const sortedIds = [...ids].sort((a, b) => a.localeCompare(b));
    expect(ids).toEqual(sortedIds);

    // 3. Each registered source URL resolves to an existing file on disk
    for (const migration of migrationFiles) {
      const filePath = fileURLToPath(migration.source);
      expect(existsSync(filePath)).toBe(true);
      expect(filePath.replace(/\\/g, '/').endsWith(`/${migration.id}.sql`)).toBe(true);
    }

    // 4. Every migrations/*.sql file on disk must be registered
    const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
    const diskEntries = await readdir(migrationsDir);
    const diskSqlFiles = diskEntries.filter((f) => f.endsWith('.sql'));
    const diskIds = diskSqlFiles.map((f) => f.replace(/\.sql$/, '')).sort();

    expect(sortedIds).toEqual(diskIds);
  });
});
