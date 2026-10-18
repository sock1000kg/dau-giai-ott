import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { publishPublicSnapshot, projectPublicSnapshot, type PublicSnapshot } from '../src/modules/public-snapshots/publisher.ts';

const snapshot = (): PublicSnapshot => ({
  schemaVersion: 1, updatedAt: '2026-10-18T00:00:00.000Z', stage: 'QUALIFICATION',
  round: { name: 'Week 1', status: 'RUNNING' }, queue: [{ position: 1, teams: 'A / B', etaSeconds: 30 }],
  results: [{ matchId: '00000000-0000-4000-8000-000000000001', teams: 'A / B', score: '1–0', syncVerified: true, replayPublished: true }],
  leaderboard: [{ rank: 1, team: 'A', rating: 1500, eligible: false }],
  rules: { version: 'r1', engineVersion: '1.0.0', sections: [{ title: 'Map', body: 'Recorded map and limits' }] },
  schedule: [], announcements: [], faq: [], status: { message: 'Running', incidentEta: null },
});
const directories: string[] = [];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'ott-public-')); directories.push(path); return path; }
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('static snapshot publisher', () => {
  it('publishes reproducible content-addressed files with an atomic latest pointer', async () => {
    const dir = await directory(), input = snapshot();
    const pointer = await publishPublicSnapshot(dir, input);
    const body = await readFile(join(dir, pointer.file));
    expect(createHash('sha256').update(body).digest('hex')).toBe(pointer.sha256);
    expect(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'))).toEqual(pointer);
    expect(await publishPublicSnapshot(dir, input)).toEqual(pointer);
  });
  it('removes extra private fields and suppresses all qualification replay availability', () => {
    const input = { ...snapshot(), seed: 'SECRET', objectKey: 'PRIVATE' };
    Object.assign(input.results[0]!, { stderr: 'SECRET', replayUrl: '/private' });
    const output = JSON.stringify(projectPublicSnapshot(input));
    expect(output).not.toMatch(/SECRET|PRIVATE|replayUrl|stderr|objectKey|seed/);
    expect(projectPublicSnapshot(input).results[0]).toMatchObject({ syncVerified: false, replayPublished: false });
  });
  it('exposes finals replay availability only after verification and publication', () => {
    const input = snapshot(); input.stage = 'FINALS';
    expect(projectPublicSnapshot(input).results[0]!.replayPublished).toBe(true);
    input.results[0]!.syncVerified = false;
    expect(projectPublicSnapshot(input).results[0]!.replayPublished).toBe(false);
  });
  it('keeps the last pointer if new input or immutable file storage fails', async () => {
    const dir = await directory(), input = snapshot();
    const pointer = await publishPublicSnapshot(dir, input);
    await expect(publishPublicSnapshot(dir, { ...input, updatedAt: 'bad' })).rejects.toThrow();
    const next = { ...input, updatedAt: '2026-10-18T00:01:00.000Z' };
    const hash = createHash('sha256').update(`${JSON.stringify(projectPublicSnapshot(next))}\n`).digest('hex');
    await mkdir(join(dir, `snapshot-${hash}.json`));
    // A pre-existing directory must not be accepted as a published immutable artifact.
    await expect(publishPublicSnapshot(dir, next)).rejects.toThrow();
    expect(JSON.parse(await readFile(join(dir, 'latest.json'), 'utf8'))).toEqual(pointer);
  });
});
