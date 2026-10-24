import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAP } from '@ott/game-core';
import { registerPublicMapRoutes } from '../src/modules/rounds/public-maps-routes.ts';
import type { Database } from '../src/db/client.ts';
import { computeRulesSha256, type RoundRuleSetRulesV1 } from '../src/modules/rounds/types.ts';

function createApp(query: ReturnType<typeof vi.fn>) {
  const app = Fastify({ logger: false });
  const db = {
    query,
    close: vi.fn(),
  } as unknown as Database;
  registerPublicMapRoutes(app, { database: db });
  return app;
}

function sampleRules(): RoundRuleSetRulesV1 {
  return {
    schemaVersion: 'ott.round-rules.v1',
    engineVersion: '1.0.0',
    mapSet: [{ mapId: DEFAULT_MAP.mapId, checksum: DEFAULT_MAP.checksum }],
    maxTurns: 200,
    faultPolicyVersion: 'P2_BASELINE_V1',
    timeControl: {
      startupMs: 5000,
      totalBotBudgetMs: 60000,
      matchWallClockMs: 150000,
      perTurn: { mode: 'FIXED', fixedMs: 1000 },
    },
    resources: {
      memoryMiB: 256,
      milliCpu: 1000,
      pids: 64,
      tmpfsMiB: 64,
      archiveMiB: 512,
      unpackedMiB: 1024,
      maxLayers: 20,
    },
    schedule: {
      submissionOpensAt: '2026-10-14T00:00:00Z',
      submissionDeadlineAt: '2026-10-15T00:00:00Z',
      graceEndsAt: '2026-10-15T12:00:00Z',
      runStartsAt: '2026-10-16T00:00:00Z',
      runMaxHours: 48,
      appealEndsAt: '2026-10-19T00:00:00Z',
    },
    testRun: {
      quotaPerTeamPerDay: 2,
      opponents: ['BTC_REFERENCE', 'OWN_SUBMISSION'],
    },
  };
}

describe('Public Maps Routes', () => {
  describe('GET /api/v1/public/rounds/current/maps', () => {
    it('returns 404 NO_PUBLISHED_ROUND when no qualification round exists', async () => {
      const query = vi.fn().mockResolvedValue({ rows: [] });
      const app = createApp(query);

      const res = await app.inject({ method: 'GET', url: '/api/v1/public/rounds/current/maps' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({
        error: { code: 'NO_PUBLISHED_ROUND', message: 'No published round' },
      });
    });

    it('returns 200 with round and maps for an open round', async () => {
      const rules = sampleRules();
      const rulesSha256 = computeRulesSha256(rules);
      const query = vi.fn().mockResolvedValue({
        rows: [{
          round_number: 5,
          status: 'SUBMISSION_OPEN',
          rules,
          rules_sha256: rulesSha256,
        }],
      });
      const app = createApp(query);

      const res = await app.inject({ method: 'GET', url: '/api/v1/public/rounds/current/maps' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.round).toEqual({ name: 'Round 5', status: 'SUBMISSION_OPEN' });
      expect(body.maps).toHaveLength(1);
      expect(body.maps[0]).toEqual({
        mapId: 'default',
        version: 1,
        checksum: DEFAULT_MAP.checksum,
        definition: DEFAULT_MAP,
      });
    });

    it('returns 404 NO_PUBLISHED_ROUND if rules fail validation', async () => {
      const rules = sampleRules();
      (rules.schedule as any).graceEndsAt = '2026-10-14T00:00:00Z'; // order violation
      const query = vi.fn().mockResolvedValue({
        rows: [{
          round_number: 1,
          status: 'SUBMISSION_OPEN',
          rules,
          rules_sha256: computeRulesSha256(rules),
        }],
      });
      const app = createApp(query);

      const res = await app.inject({ method: 'GET', url: '/api/v1/public/rounds/current/maps' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NO_PUBLISHED_ROUND');
    });

    it('returns 404 NO_PUBLISHED_ROUND if rules_sha256 does not match', async () => {
      const rules = sampleRules();
      const query = vi.fn().mockResolvedValue({
        rows: [{
          round_number: 1,
          status: 'SUBMISSION_OPEN',
          rules,
          rules_sha256: 'b'.repeat(64),
        }],
      });
      const app = createApp(query);

      const res = await app.inject({ method: 'GET', url: '/api/v1/public/rounds/current/maps' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body).error.code).toBe('NO_PUBLISHED_ROUND');
    });
  });

  describe('GET /api/v1/public/maps/:mapId', () => {
    it('returns map definition JSON with download headers when mapId and checksum match', async () => {
      const query = vi.fn();
      const app = createApp(query);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/maps/default?checksum=${DEFAULT_MAP.checksum}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['content-disposition']).toBe(`attachment; filename="default-${DEFAULT_MAP.checksum.slice(0, 8)}.json"`);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
      expect(JSON.parse(res.body)).toEqual(DEFAULT_MAP);
    });

    it('returns 404 MAP_NOT_FOUND when checksum is missing', async () => {
      const query = vi.fn();
      const app = createApp(query);

      const res = await app.inject({ method: 'GET', url: '/api/v1/public/maps/default' });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({
        error: { code: 'MAP_NOT_FOUND', message: 'Map not found' },
      });
    });

    it('returns 404 MAP_NOT_FOUND when checksum does not match', async () => {
      const query = vi.fn();
      const app = createApp(query);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/maps/default?checksum=${'f'.repeat(64)}`,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({
        error: { code: 'MAP_NOT_FOUND', message: 'Map not found' },
      });
    });

    it('returns 404 MAP_NOT_FOUND when mapId is unknown', async () => {
      const query = vi.fn();
      const app = createApp(query);

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/public/maps/unknown-map?checksum=${DEFAULT_MAP.checksum}`,
      });
      expect(res.statusCode).toBe(404);
      expect(JSON.parse(res.body)).toEqual({
        error: { code: 'MAP_NOT_FOUND', message: 'Map not found' },
      });
    });
  });
});
