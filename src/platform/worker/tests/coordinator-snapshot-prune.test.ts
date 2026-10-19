import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  pruneSnapshotDirectory,
  runSnapshotIteration,
  type SnapshotLoopDeps,
} from '../src/index.ts';

describe('Coordinator Snapshot & Pruning (P2-T32)', () => {
  it('prunes directory keeping N newest plus the target of latest.json, leaving other files intact', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-snapshot-test-'));

    try {
      // Create 5 snapshot files with distinct timestamps
      const baseTime = Date.now() - 50000;
      const files = [
        'snapshot-1111.json', // oldest (baseTime + 1000)
        'snapshot-2222.json', // (baseTime + 2000)
        'snapshot-3333.json', // (baseTime + 3000)
        'snapshot-4444.json', // (baseTime + 4000)
        'snapshot-5555.json', // newest (baseTime + 5000)
      ];

      for (let i = 0; i < files.length; i++) {
        const filePath = path.join(tmpDir, files[i]!);
        await fs.writeFile(filePath, JSON.stringify({ index: i }));
        const fileTime = new Date(baseTime + (i + 1) * 1000);
        await fs.utimes(filePath, fileTime, fileTime);
      }

      // latest.json points to snapshot-1111.json (the oldest file!)
      await fs.writeFile(
        path.join(tmpDir, 'latest.json'),
        JSON.stringify({ file: 'snapshot-1111.json', sha256: '1111' }),
      );

      // Create an unrelated file that MUST NOT be deleted
      await fs.writeFile(path.join(tmpDir, 'custom-notes.txt'), 'do not delete');

      // Prune with keepCount = 2
      // Top 2 newest are: snapshot-5555.json, snapshot-4444.json
      // PLUS snapshot-1111.json (from latest.json) MUST be kept!
      // Deleted should be: snapshot-2222.json, snapshot-3333.json
      const result = await pruneSnapshotDirectory(tmpDir, 2);

      expect(result.kept).toContain('snapshot-5555.json');
      expect(result.kept).toContain('snapshot-4444.json');
      expect(result.kept).toContain('snapshot-1111.json');
      expect(result.deleted).toEqual(expect.arrayContaining(['snapshot-2222.json', 'snapshot-3333.json']));
      expect(result.deleted).not.toContain('snapshot-1111.json');

      const remainingFiles = await fs.readdir(tmpDir);
      expect(remainingFiles).toContain('snapshot-5555.json');
      expect(remainingFiles).toContain('snapshot-4444.json');
      expect(remainingFiles).toContain('snapshot-1111.json'); // Crucial: Mutation 5 guard!
      expect(remainingFiles).not.toContain('snapshot-2222.json');
      expect(remainingFiles).not.toContain('snapshot-3333.json');
      expect(remainingFiles).toContain('latest.json');
      expect(remainingFiles).toContain('custom-notes.txt');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('never follows symlinks during pruning', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-symlink-test-'));
    const externalDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-external-test-'));

    try {
      const externalFile = path.join(externalDir, 'external.json');
      await fs.writeFile(externalFile, 'external content');

      // Create a symlink named snapshot-9999.json pointing to externalFile
      const symlinkPath = path.join(tmpDir, 'snapshot-9999.json');
      await fs.symlink(externalFile, symlinkPath);

      // Create a real snapshot
      await fs.writeFile(path.join(tmpDir, 'snapshot-real.json'), '{}');

      const result = await pruneSnapshotDirectory(tmpDir, 0);

      // Symlink must not have been deleted or followed
      expect(result.deleted).not.toContain('snapshot-9999.json');
      expect(await fs.readFile(externalFile, 'utf8')).toBe('external content');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
      await fs.rm(externalDir, { recursive: true, force: true });
    }
  });

  it('re-reads editorial file on each snapshot iteration', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ott-editorial-test-'));
    const editorialPath = path.join(tmpDir, 'editorial.json');

    const publishedEditorials: any[] = [];
    const publishFn = vi.fn().mockImplementation(async (_db, _dir, editorial) => {
      publishedEditorials.push(editorial);
    });

    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 'match-1' }] }),
    } as any;

    try {
      const deps: SnapshotLoopDeps = {
        database: mockDb,
        snapshotDir: tmpDir,
        snapshotKeep: 5,
        editorialFile: editorialPath,
        fallbackEditorial: {
          announcements: [],
          faq: [],
          status: { message: 'Fallback', incidentEta: null },
          changelog: '',
          minimumSeries: 5,
        },
        publishFn,
      };

      // 1. Initial editorial content
      await fs.writeFile(
        editorialPath,
        JSON.stringify({
          announcements: [{ title: 'Ann 1', body: 'Body 1' }],
          faq: [],
          status: { message: 'Round 1', incidentEta: null },
          changelog: 'v1',
          minimumSeries: 5,
        }),
      );

      await runSnapshotIteration(deps);
      expect(publishedEditorials[0]?.status.message).toBe('Round 1');

      // 2. BTC updates editorial file on disk without restarting process
      await fs.writeFile(
        editorialPath,
        JSON.stringify({
          announcements: [{ title: 'Ann 2', body: 'Body 2' }],
          faq: [],
          status: { message: 'Round 2 In Progress', incidentEta: null },
          changelog: 'v2',
          minimumSeries: 5,
        }),
      );

      await runSnapshotIteration(deps);
      expect(publishedEditorials[1]?.status.message).toBe('Round 2 In Progress');
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('treats "No valid announced qualification rules" as nothing to publish yet without throwing', async () => {
    const publishFn = vi.fn().mockRejectedValue(new Error('No valid announced qualification rules'));
    const mockDb = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const deps: SnapshotLoopDeps = {
      database: mockDb,
      snapshotDir: '/tmp/nonexistent-snapshot-dir',
      snapshotKeep: 5,
      editorialFile: null,
      fallbackEditorial: {
        announcements: [],
        faq: [],
        status: { message: 'Status', incidentEta: null },
        changelog: '',
        minimumSeries: 5,
      },
      publishFn,
      logger,
    };

    // Should not throw!
    await expect(runSnapshotIteration(deps)).resolves.toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith('qualification snapshot skipped: no valid announced rules');
    expect(logger.error).not.toHaveBeenCalled();
  });
});
