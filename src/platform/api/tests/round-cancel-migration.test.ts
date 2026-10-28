import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { migrationFiles } from '../src/db/schema.ts';

const migration = migrationFiles.find((entry) => entry.id === '0021_round_cancel');

describe('migration 0021_round_cancel (DB-free checks; apply-on-fresh-DB is covered by round-cancel.integration.test.ts)', () => {
  const sql = readFileSync(fileURLToPath(migration!.source), 'utf8');

  it('is registered after the previous migration', () => {
    const ids = migrationFiles.map((entry) => entry.id);
    const roundCancelIndex = ids.indexOf('0021_round_cancel');
    expect(ids[roundCancelIndex - 1]).toBe('0020_test_run_frontend_contract');
    expect(ids[roundCancelIndex + 1]).toBe('0022_reference_bot_portal');
  });

  it('adds CANCELLED to the status CHECK while keeping every previous status', () => {
    const check = /ADD CONSTRAINT qualification_rounds_status_check\s+CHECK \(status IN \(([^)]*)\)\)/.exec(sql);
    const statuses = [...(check?.[1] ?? '').matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]);
    expect(statuses).toEqual(['DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED', 'RUNNING', 'SETTLING', 'RATED', 'PUBLISHED', 'CANCELLED']);
  });

  it('frees the active-round slot for CANCELLED and only allows cancel before RUNNING', () => {
    expect(sql).toContain("WHERE status NOT IN ('PUBLISHED', 'CANCELLED')");
    expect(sql).toContain("OLD.status IN ('DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED') AND NEW.status = 'CANCELLED'");
    expect(sql).not.toMatch(/OLD\.status = 'CANCELLED'/);
    expect(sql).toContain('ADD COLUMN cancelled_at TIMESTAMPTZ');
    expect(sql).toContain('ADD COLUMN cancel_reason TEXT');
  });
});
