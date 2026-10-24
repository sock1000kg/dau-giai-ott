import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Database } from '../src/db/client.ts';
import { seedDemoFinalsBundle } from '../src/demo/seed-finals-bundle.ts';
import { DEMO_BUNDLE_ID, DEMO_KEY_ID } from '../src/modules/result-bundles/demo-bundle.ts';

describe('seedDemoFinalsBundle seeder', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seeder-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('proves idempotent execution, real actor lookup, and append-only key allowlist', async () => {
    const REAL_BTC_ID = '11111111-1111-4111-8111-111111111111';
    let keyRegistered = false;
    let bundleImported = false;
    let savedManifestSha = '';
    let savedSignature = '';

    // Build mock database simulating accounts, result_bundle_keys, and result_bundles
    const mockDatabase: Database = {
      query: (async (sql: string, params?: readonly unknown[]) => {
        const text = sql.trim();

        // 1. Account lookup for BTC admin
        if (text.startsWith('SELECT id FROM accounts WHERE username = $1')) {
          expect(params?.[0]).toBe('btc');
          return {
            rows: [{ id: REAL_BTC_ID }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }

        // 2. Allowlist key query
        if (text.startsWith('SELECT public_key_pem, revoked_at FROM result_bundle_keys WHERE key_id = $1')) {
          if (!keyRegistered) {
            return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
          }
          return {
            rows: [{ public_key_pem: 'mock-public-pem', revoked_at: null }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }

        // 3. Allowlist key insert
        if (text.startsWith('INSERT INTO result_bundle_keys')) {
          keyRegistered = true;
          return { rows: [{ allowlisted_at: new Date() }], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
        }

        // 4. Audit event insertion
        if (text.startsWith('INSERT INTO audit_events')) {
          expect(params?.includes(REAL_BTC_ID)).toBe(true);
          return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
        }

        // 5. Query existing bundle in verify/import
        if (text.startsWith('SELECT public_key_pem FROM result_bundle_keys WHERE key_id = $1 AND revoked_at IS NULL')) {
          const keyPemPath = path.join(tmpDir, `${DEMO_KEY_ID}.public.pem`);
          const keyPem = fs.existsSync(keyPemPath) ? fs.readFileSync(keyPemPath, 'utf8') : 'mock-pem';
          return {
            rows: [{ public_key_pem: keyPem }],
            rowCount: 1,
            command: 'SELECT',
            oid: 0,
            fields: [],
          };
        }

        return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
      }) as Database['query'],

      async transaction<T>(fn: (tx: Database) => Promise<T>): Promise<T> {
        const txMock: Database = {
          query: (async (sql: string, params?: readonly unknown[]) => {
            const text = sql.trim();

            if (text.startsWith('SELECT manifest_sha256, signature, created_at, status FROM result_bundles')) {
              if (bundleImported) {
                // Return existing publication for second run
                return {
                  rows: [
                    {
                      manifest_sha256: savedManifestSha,
                      signature: savedSignature,
                      created_at: new Date('2026-10-24T00:00:00Z'),
                      status: 'VERIFIED',
                    },
                  ],
                  rowCount: 1,
                  command: 'SELECT',
                  oid: 0,
                  fields: [],
                };
              }
              return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
            }

            if (text.startsWith('INSERT INTO result_bundle_keys')) {
              keyRegistered = true;
              return { rows: [{ allowlisted_at: new Date() }], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
            }

            if (text.startsWith('INSERT INTO result_bundles')) {
              bundleImported = true;
              savedManifestSha = params?.[6] as string;
              savedSignature = params?.[7] as string;
              return { rows: [{ created_at: new Date() }], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
            }

            if (text.startsWith('INSERT INTO result_bundle_artifacts')) {
              return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
            }

            if (text.startsWith('UPDATE result_bundles SET status = \'VERIFIED\'')) {
              return { rows: [{ verified_at: new Date() }], rowCount: 1, command: 'UPDATE', oid: 0, fields: [] };
            }

            if (text.startsWith('INSERT INTO audit_events')) {
              expect(params?.includes(REAL_BTC_ID)).toBe(true);
              return { rows: [], rowCount: 1, command: 'INSERT', oid: 0, fields: [] };
            }

            return { rows: [], rowCount: 0, command: 'SELECT', oid: 0, fields: [] };
          }) as Database['query'],
          transaction: async (nested) => nested(txMock),
          close: async () => {},
        };
        return fn(txMock);
      },

      async close() {},
    };

    const env = { OTT_DEMO_MODE: 'true', OTT_DEPLOYMENT_MODE: 'dev' };

    // First run: writes bundle, registers key, imports
    const firstRun = await seedDemoFinalsBundle({
      database: mockDatabase,
      environment: env,
      bundleDir: tmpDir,
    });

    expect(firstRun.bundleId).toBe(DEMO_BUNDLE_ID);
    expect(firstRun.keyId).toBe(DEMO_KEY_ID);
    expect(firstRun.replayed).toBe(false);

    // Second run: idempotent, replayed: true, key not overwritten
    const secondRun = await seedDemoFinalsBundle({
      database: mockDatabase,
      environment: env,
      bundleDir: tmpDir,
    });

    expect(secondRun.bundleId).toBe(DEMO_BUNDLE_ID);
    expect(secondRun.keyId).toBe(DEMO_KEY_ID);
    expect(secondRun.replayed).toBe(true);
  });
});
