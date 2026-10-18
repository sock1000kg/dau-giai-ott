import type { PublicSnapshot } from '@ott/platform-api';

export type { PublicSnapshot };
const hashPattern = /^[0-9a-f]{64}$/;
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid snapshot');
  return value as Record<string, unknown>;
};
const text = (value: unknown) => typeof value === 'string';
const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const rows = (value: unknown, check: (row: Record<string, unknown>) => boolean) =>
  Array.isArray(value) && value.every((row) => check(record(row)));

export function parsePublicSnapshot(value: unknown): PublicSnapshot {
  const s = record(value), round = record(s.round), rules = record(s.rules), status = record(s.status);
  const sections = (value: unknown) => rows(value, (row) => text(row.title) && text(row.body));
  if (s.schemaVersion !== 1 || !text(s.updatedAt) || !Number.isFinite(Date.parse(String(s.updatedAt)))
    || !['QUALIFICATION', 'FINALS'].includes(String(s.stage)) || !text(round.name) || !text(round.status)
    || !rows(s.queue, (r) => number(r.position) && text(r.teams) && (r.etaSeconds === null || number(r.etaSeconds)))
    || !rows(s.results, (r) => typeof r.matchId === 'string' && /^[0-9a-f-]{36}$/i.test(r.matchId)
      && text(r.teams) && text(r.score) && typeof r.syncVerified === 'boolean' && typeof r.replayPublished === 'boolean')
    || !rows(s.leaderboard, (r) => number(r.rank) && text(r.team) && number(r.rating) && typeof r.eligible === 'boolean')
    || !text(rules.version) || !text(rules.engineVersion) || !sections(rules.sections)
    || !sections(s.schedule) || !sections(s.announcements) || !sections(s.faq)
    || !text(status.message) || !(status.incidentEta === null || text(status.incidentEta))) throw new Error('Invalid snapshot');
  return s as unknown as PublicSnapshot;
}

export async function loadPublicSnapshot(previous: PublicSnapshot | null, signal?: AbortSignal): Promise<PublicSnapshot> {
  const options: RequestInit = { cache: 'no-cache', credentials: 'omit', ...(signal ? { signal } : {}) };
  const response = await fetch('/snapshots/latest.json', options);
  if (!response.ok) throw new Error('Snapshot unavailable');
  const pointer = record(await response.json());
  if (pointer.schemaVersion !== 1 || typeof pointer.sha256 !== 'string' || !hashPattern.test(pointer.sha256)
    || pointer.file !== `snapshot-${pointer.sha256}.json` || !text(pointer.updatedAt)) throw new Error('Invalid snapshot pointer');
  const artifact = await fetch(`/snapshots/${pointer.file}`, { ...options, cache: 'force-cache' });
  if (!artifact.ok) throw new Error('Snapshot unavailable');
  const bytes = await artifact.arrayBuffer();
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  if (digest !== pointer.sha256) throw new Error('Snapshot checksum mismatch');
  const snapshot = parsePublicSnapshot(JSON.parse(new TextDecoder().decode(bytes)));
  if (snapshot.updatedAt !== pointer.updatedAt || (previous && Date.parse(snapshot.updatedAt) < Date.parse(previous.updatedAt))) throw new Error('Outdated snapshot');
  return snapshot;
}
