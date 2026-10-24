import { verifyReplayResponse } from '../spectator/verify-replay.ts';
import type { SpectatorReplay } from '../spectator/replay-schema.ts';

export type TestRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
export type TestRunOpponentType = 'BTC_REFERENCE' | 'OWN_SUBMISSION';

export interface TestRun {
  readonly id: string;
  readonly submissionId: string;
  readonly opponentType: TestRunOpponentType;
  readonly opponentSubmissionId: string | null;
  readonly opponentReferenceBot: string | null;
  readonly status: TestRunStatus;
  readonly quotaConsumed: boolean;
  readonly result: Readonly<Record<string, unknown>> | null;
  readonly stderrX: string | null;
  readonly stderrO: string | null;
  readonly failureReason: string | null;
  readonly isInfraFailure: boolean;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly finishedAt: string | null;
}

export interface TestRunPage {
  readonly items: readonly TestRun[];
  readonly pagination: { readonly page: number; readonly pageSize: number; readonly totalItems: number; readonly totalPages: number };
}

export interface TestRunPolicy {
  readonly roundId: string | null;
  readonly quota: {
    readonly limit: number;
    readonly consumed: number;
    readonly reserved: number;
    readonly remaining: number;
    readonly resetsAt: string;
  };
  readonly admissionPaused: boolean;
  readonly opponents: {
    readonly referenceBots: readonly { readonly id: string; readonly displayName: string }[];
    readonly ownSubmissionAllowed: boolean;
  };
  readonly maps: readonly {
    readonly mapId: string;
    readonly version: number;
    readonly checksum: string;
    readonly name?: string;
  }[];
}

export interface CreateTestRunInput {
  readonly submissionId: string;
  readonly opponentType: TestRunOpponentType;
  readonly opponentReferenceBot?: string;
  readonly opponentSubmissionId?: string;
  readonly roundId?: string | null;
  readonly mapId?: string;
  readonly mapChecksum?: string;
}

interface ErrorEnvelope { readonly error?: { readonly code?: unknown } }

const statuses = new Set<TestRunStatus>(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED']);
const opponentTypes = new Set<TestRunOpponentType>(['BTC_REFERENCE', 'OWN_SUBMISSION']);

export class TestRunApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;

  public constructor(status: number, code: string | null) {
    super('Test run request failed');
    this.name = 'TestRunApiError';
    this.status = status;
    this.code = code;
  }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid test run response');
  return value as Record<string, unknown>;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error('Invalid test run response');
  return value;
}

function pageInfo(value: unknown): TestRunPage['pagination'] {
  const page = object(value);
  const numbers = [page.page, page.pageSize, page.totalItems, page.totalPages];
  if (!numbers.every((part) => Number.isSafeInteger(part) && Number(part) >= 0)
    || Number(page.page) < 1 || Number(page.pageSize) < 1) throw new Error('Invalid test run pagination');
  return { page: Number(page.page), pageSize: Number(page.pageSize), totalItems: Number(page.totalItems), totalPages: Number(page.totalPages) };
}

function testRunOf(value: unknown): TestRun {
  const row = object(value);
  if (typeof row.id !== 'string' || row.id.length === 0
    || typeof row.submissionId !== 'string' || row.submissionId.length === 0
    || typeof row.opponentType !== 'string' || !opponentTypes.has(row.opponentType as TestRunOpponentType)
    || typeof row.status !== 'string' || !statuses.has(row.status as TestRunStatus)
    || typeof row.quotaConsumed !== 'boolean'
    || typeof row.isInfraFailure !== 'boolean'
    || typeof row.createdAt !== 'string' || Number.isNaN(Date.parse(row.createdAt))) {
    throw new Error('Invalid test run response');
  }
  let result: Readonly<Record<string, unknown>> | null = null;
  if (row.result !== null) result = object(row.result);
  const startedAt = nullableString(row.startedAt);
  const finishedAt = nullableString(row.finishedAt);
  if ((startedAt !== null && Number.isNaN(Date.parse(startedAt))) || (finishedAt !== null && Number.isNaN(Date.parse(finishedAt)))) {
    throw new Error('Invalid test run response');
  }
  return {
    id: row.id,
    submissionId: row.submissionId,
    opponentType: row.opponentType as TestRunOpponentType,
    opponentSubmissionId: nullableString(row.opponentSubmissionId),
    opponentReferenceBot: nullableString(row.opponentReferenceBot),
    status: row.status as TestRunStatus,
    quotaConsumed: row.quotaConsumed,
    result,
    stderrX: nullableString(row.stderrX),
    stderrO: nullableString(row.stderrO),
    failureReason: nullableString(row.failureReason),
    isInfraFailure: row.isInfraFailure,
    createdAt: row.createdAt,
    startedAt,
    finishedAt,
  };
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    let body: unknown;
    try { body = JSON.parse(text); } catch { body = undefined; }
    const code = typeof body === 'object' && body !== null ? (body as ErrorEnvelope).error?.code : null;
    throw new TestRunApiError(response.status, typeof code === 'string' ? code : null);
  }
  try { return JSON.parse(text) as unknown; } catch { throw new Error('Invalid test run response'); }
}

function envelopeData(value: unknown): unknown {
  const body = object(value);
  if (!('data' in body)) throw new Error('Invalid test run response');
  return body.data;
}

export async function getTestRunPolicy(): Promise<TestRunPolicy> {
  const response = await fetch('/api/v1/test-run-policy', { credentials: 'include' });
  const data = object(envelopeData(await readJson(response)));
  const quota = object(data.quota);
  const opponents = object(data.opponents);
  const quotaValues = [quota.limit, quota.consumed, quota.reserved, quota.remaining];
  if (!quotaValues.every((part) => Number.isSafeInteger(part) && Number(part) >= 0)
    || typeof quota.resetsAt !== 'string' || Number.isNaN(Date.parse(quota.resetsAt))
    || typeof data.admissionPaused !== 'boolean' || !Array.isArray(opponents.referenceBots)
    || typeof opponents.ownSubmissionAllowed !== 'boolean') throw new Error('Invalid test run policy');
  const referenceBots = opponents.referenceBots.map((item) => {
    const bot = object(item);
    if (typeof bot.id !== 'string' || typeof bot.displayName !== 'string') throw new Error('Invalid test run policy');
    return { id: bot.id, displayName: bot.displayName };
  });
  const rawMaps = Array.isArray(data.maps) ? data.maps : [];
  const maps = rawMaps.map((item) => {
    const m = object(item);
    if (typeof m.mapId !== 'string' || typeof m.version !== 'number' || typeof m.checksum !== 'string') {
      throw new Error('Invalid test run policy');
    }
    return {
      mapId: m.mapId,
      version: m.version,
      checksum: m.checksum,
      ...(typeof m.name === 'string' ? { name: m.name } : {}),
    };
  });
  const roundId = nullableString(data.roundId);
  return {
    roundId,
    quota: { limit: Number(quota.limit), consumed: Number(quota.consumed), reserved: Number(quota.reserved), remaining: Number(quota.remaining), resetsAt: quota.resetsAt },
    admissionPaused: data.admissionPaused,
    opponents: { referenceBots, ownSubmissionAllowed: opponents.ownSubmissionAllowed },
    maps,
  };
}

export async function listTestRuns(page = 1, pageSize = 20): Promise<TestRunPage> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const body = object(await readJson(await fetch(`/api/v1/test-runs?${query}`, { credentials: 'include' })));
  if (!Array.isArray(body.data) || !('pagination' in body)) throw new Error('Invalid test run response');
  return { items: body.data.map(testRunOf), pagination: pageInfo(body.pagination) };
}

export async function getTestRun(id: string): Promise<TestRun> {
  const data = envelopeData(await readJson(await fetch(`/api/v1/test-runs/${encodeURIComponent(id)}`, { credentials: 'include' })));
  return testRunOf(data);
}

export async function createTestRun(input: CreateTestRunInput, idempotencyKey: string): Promise<TestRun> {
  const response = await fetch('/api/v1/test-runs', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(input),
  });
  return testRunOf(envelopeData(await readJson(response)));
}

export async function fetchTestRunReplay(id: string): Promise<SpectatorReplay> {
  let response: Response;
  try {
    response = await fetch(`/api/v1/test-runs/${encodeURIComponent(id)}/replay`, { credentials: 'include' });
  } catch {
    throw new Error('REPLAY_UNAVAILABLE');
  }
  return verifyReplayResponse(response);
}
