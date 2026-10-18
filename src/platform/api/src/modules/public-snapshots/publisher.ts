import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile, readFile, link, rm } from 'node:fs/promises';
import { join } from 'node:path';

export interface PublicSnapshot {
  schemaVersion: 1;
  updatedAt: string;
  stage: 'QUALIFICATION' | 'FINALS';
  round: { name: string; status: string };
  queue: { position: number; teams: string; etaSeconds: number | null }[];
  results: { matchId: string; teams: string; score: string; syncVerified: boolean; replayPublished: boolean }[];
  leaderboard: { rank: number; team: string; rating: number; eligible: boolean }[];
  rules: { version: string; engineVersion: string; sections: { title: string; body: string }[] };
  schedule: { title: string; body: string }[];
  announcements: { title: string; body: string }[];
  faq: { title: string; body: string }[];
  status: { message: string; incidentEta: string | null };
}

/** Explicit projection prevents private fields from leaking into the public artifact. */
export function projectPublicSnapshot(source: PublicSnapshot): PublicSnapshot {
  if (source.schemaVersion !== 1 || !Number.isFinite(Date.parse(source.updatedAt))
    || !['QUALIFICATION', 'FINALS'].includes(source.stage)) throw new Error('Invalid public snapshot');
  const text = (value: string): string => {
    if (typeof value !== 'string') throw new Error('Invalid snapshot text');
    return value;
  };
  const number = (value: number): number => {
    if (!Number.isFinite(value) || value < 0) throw new Error('Invalid snapshot number');
    return value;
  };
  const flag = (value: boolean): boolean => {
    if (typeof value !== 'boolean') throw new Error('Invalid snapshot flag');
    return value;
  };
  const sections = (rows: { title: string; body: string }[]) => rows.map(({ title, body }) => ({ title: text(title), body: text(body) }));
  return {
    schemaVersion: 1, updatedAt: source.updatedAt, stage: source.stage,
    round: { name: text(source.round.name), status: text(source.round.status) },
    queue: source.queue.map((row) => ({ position: number(row.position), teams: text(row.teams), etaSeconds: row.etaSeconds === null ? null : number(row.etaSeconds) })),
    results: source.results.map((row) => {
      if (!/^[0-9a-f-]{36}$/i.test(row.matchId)) throw new Error('Invalid public match ID');
      return { matchId: row.matchId, teams: text(row.teams), score: text(row.score),
        syncVerified: source.stage === 'FINALS' && flag(row.syncVerified),
        replayPublished: source.stage === 'FINALS' && row.syncVerified === true && flag(row.replayPublished) };
    }),
    leaderboard: source.leaderboard.map((row) => ({ rank: number(row.rank), team: text(row.team), rating: number(row.rating), eligible: flag(row.eligible) })),
    rules: { version: text(source.rules.version), engineVersion: text(source.rules.engineVersion), sections: sections(source.rules.sections) },
    schedule: sections(source.schedule), announcements: sections(source.announcements), faq: sections(source.faq),
    status: { message: text(source.status.message), incidentEta: source.status.incidentEta === null ? null : text(source.status.incidentEta) },
  };
}

/** Publish immutable data first, then atomically replace the small latest pointer. */
export async function publishPublicSnapshot(directory: string, source: PublicSnapshot) {
  const snapshot = projectPublicSnapshot(source);
  const body = `${JSON.stringify(snapshot)}\n`;
  const sha256 = createHash('sha256').update(body).digest('hex');
  const file = `snapshot-${sha256}.json`;
  await mkdir(directory, { recursive: true });
  const pointer = { schemaVersion: 1, file, sha256, updatedAt: snapshot.updatedAt };
  const temporary = join(directory, `.latest-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, body, { flag: 'wx' });
    try { await link(temporary, join(directory, file)); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (await readFile(join(directory, file), 'utf8') !== body) throw new Error('Existing snapshot integrity failure');
    }
    // Unlink before reusing the temp name so the immutable hard link stays unchanged.
    await rm(temporary);
    await writeFile(temporary, `${JSON.stringify(pointer)}\n`, { flag: 'wx' });
    await rename(temporary, join(directory, 'latest.json'));
  } finally { await rm(temporary, { force: true }); }
  return pointer;
}
