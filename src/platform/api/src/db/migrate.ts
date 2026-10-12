import { createDatabase, runMigrations } from './client.ts';

const connectionString = process.env.DATABASE_URL;
if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is required to run migrations');
}

const database = createDatabase({ connectionString });
try {
  const result = await runMigrations(database);
  process.stdout.write(`Applied migrations: ${result.applied.join(', ') || 'none'}\n`);
} finally {
  await database.close();
}
