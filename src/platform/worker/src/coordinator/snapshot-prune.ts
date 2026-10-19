import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export interface SnapshotPruneLogger {
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
}

export interface PruneResult {
  readonly kept: readonly string[];
  readonly deleted: readonly string[];
}

export async function pruneSnapshotDirectory(
  snapshotDir: string,
  keepCount: number,
  logger?: SnapshotPruneLogger,
): Promise<PruneResult> {
  try {
    // 1. Read latest.json pointer if present
    let latestTargetFile: string | null = null;
    try {
      const latestPath = path.join(snapshotDir, 'latest.json');
      const content = await fs.readFile(latestPath, 'utf8');
      const parsed = JSON.parse(content) as { file?: unknown };
      if (typeof parsed.file === 'string' && parsed.file.length > 0) {
        latestTargetFile = path.basename(parsed.file);
      }
    } catch {
      // latest.json may not exist yet or be temporarily unavailable
      latestTargetFile = null;
    }

    // 2. Read directory entries
    let entries;
    try {
      entries = await fs.readdir(snapshotDir, { withFileTypes: true });
    } catch (err) {
      logger?.error('snapshot prune error');
      return { kept: [], deleted: [] };
    }

    // 3. Filter strictly: snapshot-*.json, real files only (no symlinks)
    const snapshotPattern = /^snapshot-[a-f0-9]+\.json$/;
    const fileInfos: { name: string; mtimeMs: number }[] = [];

    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (!snapshotPattern.test(entry.name)) {
        continue;
      }

      const filePath = path.join(snapshotDir, entry.name);
      try {
        const stat = await fs.lstat(filePath);
        fileInfos.push({ name: entry.name, mtimeMs: stat.mtimeMs });
      } catch {
        // file removed or inaccessible concurrently
      }
    }

    // 4. Sort descending by mtime (newest first)
    fileInfos.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // 5. Select kept files: top keepCount newest PLUS latestTargetFile
    const keptSet = new Set<string>();
    const topNewest = fileInfos.slice(0, Math.max(0, keepCount));
    for (const info of topNewest) {
      keptSet.add(info.name);
    }
    if (latestTargetFile !== null) {
      // Ensure the file latest.json points to is ALWAYS preserved
      keptSet.add(latestTargetFile);
    }

    // 6. Delete remaining snapshot-*.json files
    const deleted: string[] = [];
    for (const info of fileInfos) {
      if (!keptSet.has(info.name)) {
        try {
          await fs.unlink(path.join(snapshotDir, info.name));
          deleted.push(info.name);
        } catch {
          logger?.error('snapshot prune error');
        }
      }
    }

    return {
      kept: Array.from(keptSet),
      deleted,
    };
  } catch {
    logger?.error('snapshot prune error');
    return { kept: [], deleted: [] };
  }
}
