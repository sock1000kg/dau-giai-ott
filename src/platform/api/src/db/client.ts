import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

import { loadMigrations } from './schema.ts';

export interface DatabaseOptions {
  readonly connectionString: string;
}

export interface Database {
  query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
  transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class TransactionDatabase implements Database {
  private readonly client: PoolClient;

  public constructor(client: PoolClient) {
    this.client = client;
  }

  public query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    return values === undefined
      ? this.client.query<Row>(text)
      : this.client.query<Row>(text, [...values]);
  }

  public async transaction<T>(_work: (transaction: Database) => Promise<T>): Promise<T> {
    throw new Error('Nested transactions are not supported');
  }

  public async close(): Promise<void> {
    throw new Error('A transaction-scoped database cannot be closed');
  }
}

class PostgresDatabase implements Database {
  private readonly pool: Pool;

  public constructor(options: DatabaseOptions) {
    this.pool = new Pool({ connectionString: options.connectionString });
  }

  public query<Row extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]): Promise<QueryResult<Row>> {
    return values === undefined
      ? this.pool.query<Row>(text)
      : this.pool.query<Row>(text, [...values]);
  }

  public async transaction<T>(work: (transaction: Database) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const transaction = new TransactionDatabase(client);
    try {
      await client.query('BEGIN');
      const result = await work(transaction);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export function createDatabase(options: DatabaseOptions): Database {
  return new PostgresDatabase(options);
}

export async function runMigrations(database: Database): Promise<{ readonly applied: readonly string[] }> {
  return database.transaction(async (transaction) => {
    await transaction.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const applied: string[] = [];
    for (const migration of await loadMigrations()) {
      const result = await transaction.query<{ readonly checksum: string }>(
        'SELECT checksum FROM schema_migrations WHERE id = $1',
        [migration.id],
      );
      const existing = result.rows[0];
      if (existing !== undefined) {
        if (existing.checksum !== migration.checksum) {
          throw new Error(`Migration ${migration.id} does not match its recorded checksum`);
        }
        continue;
      }
      await transaction.query(migration.sql);
      await transaction.query('INSERT INTO schema_migrations (id, checksum) VALUES ($1, $2)', [migration.id, migration.checksum]);
      applied.push(migration.id);
    }
    return { applied };
  });
}
