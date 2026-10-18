import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { Queue } from 'bullmq';
import { MATCH_QUEUE_NAME } from '@ott/job-contract';
import { createDatabase } from '../../db/client.ts';
import { publishQualificationSnapshot, type PublicEditorial } from './source.ts';

const [directory, editorialFile, mode] = process.argv.slice(2);
if (!directory || !editorialFile || !process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error('Usage: DATABASE_URL=... REDIS_URL=... tsx live.ts OUTPUT_DIRECTORY EDITORIAL.json [--once]');
}
const url = new URL(process.env.REDIS_URL);
if (!['redis:', 'rediss:'].includes(url.protocol)) throw new Error('Invalid Redis URL');
const queue = new Queue(MATCH_QUEUE_NAME, { connection: {
  host: url.hostname, port: Number(url.port || 6379), db: Number(url.pathname.slice(1) || 0),
  ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
  ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
  ...(url.protocol === 'rediss:' ? { tls: {} } : {}),
} });
queue.on('error', () => console.error('Public snapshot queue unavailable'));
const database = createDatabase({ connectionString: process.env.DATABASE_URL });
const stop = new AbortController();
process.once('SIGINT', () => stop.abort()); process.once('SIGTERM', () => stop.abort());
try {
  do {
    try {
      const editorial: PublicEditorial = JSON.parse(await readFile(editorialFile, 'utf8'));
      const jobs = await queue.getJobs(['active', 'prioritized', 'waiting'], 0, -1, true);
      const ids = jobs.map((job) => job.data.matchId).filter((id): id is string => typeof id === 'string');
      const pointer = await publishQualificationSnapshot(database, directory, editorial, ids);
      console.log(JSON.stringify({ event: 'public_snapshot_published', ...pointer }));
    } catch {
      console.error('Public snapshot publish failed; last good files retained');
      if (mode === '--once') process.exitCode = 1;
    }
    if (mode === '--once' || stop.signal.aborted) break;
    await delay(30_000, undefined, { signal: stop.signal }).catch(() => {});
  } while (!stop.signal.aborted);
} finally { await queue.close(); await database.close(); }
