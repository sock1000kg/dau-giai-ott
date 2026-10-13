import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '@ott/platform-api';
import { describe, expect, it } from 'vitest';
import { composeBaseArgs, createQualificationProjectName, parsePublishedPort } from './helpers.ts';
import { assertQualificationPrerequisites } from './qualification-fixtures.ts';
import { SANDBOX_POLICY_V1 } from '../../src/platform/worker/src/sandbox/policy.ts';

describe('qualification harness', () => {
  it('generates a unique Compose project and scopes every command to it', () => {
    const project = createQualificationProjectName('0123456789abcdef0123456789abcdef');
    const args = composeBaseArgs(project, '/tmp/qualification.env', '/repo/infra/local/compose.yaml');
    expect(project).toBe('ott-qualification-0123456789abcdef0123456789abcdef');
    expect(args).toEqual(['compose', '--project-name', project, '--env-file', '/tmp/qualification.env', '-f', '/repo/infra/local/compose.yaml']);
    expect(args).not.toContain('--all');
  });

  it('accepts only a loopback published port from Compose', () => {
    expect(parsePublishedPort('127.0.0.1:32768\n')).toBe(32768);
    expect(() => parsePublishedPort('0.0.0.0:32768')).toThrow(/loopback/i);
    expect(() => parsePublishedPort('127.0.0.1:not-a-port')).toThrow(/port/i);
  });

  it('fails before creating resources when corpus or sandbox profile is missing', async () => {
    const missingRoot = await mkdtemp(join(tmpdir(), 'ott-qualification-missing-'));
    try {
      await expect(assertQualificationPrerequisites(missingRoot)).rejects.toThrow(/corpus/i);
      await expect(assertQualificationPrerequisites(process.cwd(), { policy: { ...SANDBOX_POLICY_V1, version: 'OTT_SANDBOX_MISSING' } })).rejects.toThrow(/profile/i);
    } finally {
      await rm(missingRoot, { recursive: true, force: true });
    }
  });

  it('seeds exactly two active canary submissions in this run database', async () => {
    const databaseUrl = process.env.DATABASE_URL;
    const namespace = process.env.OTT_E2E_NAMESPACE;
    expect(databaseUrl).toBeTruthy();
    expect(namespace).toMatch(/^[a-f0-9]{32}$/);
    const database = createDatabase({ connectionString: databaseUrl! });
    try {
      const result = await database.query<{ readonly count: string }>(
        "SELECT count(*)::text AS count FROM submissions s JOIN teams t ON t.id = s.team_id WHERE t.name LIKE $1 AND s.status = 'ACTIVE' AND s.policy_version = 'P2_BASELINE_V1'",
        [`qualification-${namespace}-%`],
      );
      expect(result.rows[0]?.count).toBe('2');
    } finally {
      await database.close();
    }
  });
});
