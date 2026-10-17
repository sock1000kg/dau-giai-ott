import type { RoundRuleSetRulesV1 } from './rules-form.ts';

export type TournamentStage = string;

export type RoundStatus =
  | 'DRAFT_RULES'
  | 'SUBMISSION_OPEN'
  | 'SUBMISSION_CLOSED'
  | 'RUNNING'
  | 'SETTLING'
  | 'RATED'
  | 'PUBLISHED';

export type RoundActionType = 'open' | 'close' | 'start' | 'pause' | 'resume' | 'reconcile' | 'publish';

export interface RuleSetSummary {
  readonly id: string;
  readonly version: number;
  readonly rulesSha256: string;
  readonly reason: string;
  readonly createdAt: string;
}

export interface RuleSetDetail extends RuleSetSummary {
  readonly tournamentStage: string;
  readonly rules: RoundRuleSetRulesV1;
}

export interface RoundSummary {
  readonly id: string;
  readonly tournamentStage: string;
  readonly roundNumber: number;
  readonly status: RoundStatus;
  readonly ruleSetId: string | null;
  readonly scheduleRoundId: string | null;
  readonly pausedAt: string | null;
  readonly createdAt: string;
  readonly allowedActions: readonly RoundActionType[];
  readonly replayed?: boolean;
}

export interface ServerValidationDetail {
  readonly path: string;
  readonly code: string;
}

export class RoundAdminApiError extends Error {
  public readonly status: number;
  public readonly code: string | null;
  public readonly details: readonly ServerValidationDetail[];

  public constructor(status: number, code: string | null, details: readonly ServerValidationDetail[] = []) {
    super('Round administration request failed');
    this.name = 'RoundAdminApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const ROUND_STATUSES: readonly string[] = [
  'DRAFT_RULES', 'SUBMISSION_OPEN', 'SUBMISSION_CLOSED', 'RUNNING', 'SETTLING', 'RATED', 'PUBLISHED',
];

const ROUND_ACTIONS: readonly string[] = ['open', 'close', 'start', 'pause', 'resume', 'reconcile', 'publish'];

function object(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function serverDetails(value: unknown): ServerValidationDetail[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
    .filter((entry) => typeof entry.path === 'string' && typeof entry.code === 'string')
    .map((entry) => ({ path: entry.path as string, code: entry.code as string }));
}

async function request(path: string, init: RequestInit = {}): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, { ...init, headers, credentials: 'include' });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const root = typeof body === 'object' && body !== null && 'error' in body ? object(body.error, 'Invalid round admin error response') : null;
    throw new RoundAdminApiError(
      response.status,
      typeof root?.code === 'string' ? root.code : null,
      root !== null ? serverDetails(root.details) : [],
    );
  }
  return body;
}

function ruleSetSummary(value: unknown): RuleSetSummary {
  const row = object(value, 'Invalid rule set response');
  const version = Number(row.version);
  if (typeof row.id !== 'string' || !Number.isSafeInteger(version)
    || typeof row.rulesSha256 !== 'string' || typeof row.reason !== 'string'
    || typeof row.createdAt !== 'string') throw new Error('Invalid rule set response');
  return { id: row.id, version, rulesSha256: row.rulesSha256, reason: row.reason, createdAt: row.createdAt };
}

function ruleSetDetail(value: unknown): RuleSetDetail {
  const summary = ruleSetSummary(value);
  const row = object(value, 'Invalid rule set response');
  if (typeof row.tournamentStage !== 'string') throw new Error('Invalid rule set response');
  return { ...summary, tournamentStage: row.tournamentStage, rules: object(row.rules, 'Invalid rule set response') as unknown as RoundRuleSetRulesV1 };
}

function roundSummary(value: unknown): RoundSummary {
  const row = object(value, 'Invalid round response');
  const roundNumber = Number(row.roundNumber);
  if (typeof row.id !== 'string' || typeof row.tournamentStage !== 'string'
    || !Number.isSafeInteger(roundNumber) || !ROUND_STATUSES.includes(String(row.status))
    || (row.ruleSetId !== null && typeof row.ruleSetId !== 'string')
    || (row.scheduleRoundId !== null && typeof row.scheduleRoundId !== 'string')
    || (row.pausedAt !== null && typeof row.pausedAt !== 'string')
    || typeof row.createdAt !== 'string' || !Array.isArray(row.allowedActions)
    || !row.allowedActions.every((action): action is RoundActionType => typeof action === 'string' && ROUND_ACTIONS.includes(action))
    || (row.replayed !== undefined && typeof row.replayed !== 'boolean')) throw new Error('Invalid round response');
  return {
    id: row.id,
    tournamentStage: row.tournamentStage,
    roundNumber,
    status: row.status as RoundStatus,
    ruleSetId: row.ruleSetId,
    scheduleRoundId: row.scheduleRoundId,
    pausedAt: row.pausedAt,
    createdAt: row.createdAt,
    allowedActions: row.allowedActions as RoundActionType[],
    ...(typeof row.replayed === 'boolean' ? { replayed: row.replayed } : {}),
  };
}

export async function listRuleSets(stage: string): Promise<readonly RuleSetSummary[]> {
  const body = object(await request(`/api/v1/admin/round-rule-sets?tournamentStage=${encodeURIComponent(stage)}`), 'Invalid rule set list response');
  const data = object(body.data, 'Invalid rule set list response');
  if (!Array.isArray(data.items)) throw new Error('Invalid rule set list response');
  return data.items.map(ruleSetSummary);
}

export async function getRuleSetDetail(ruleSetId: string): Promise<RuleSetDetail> {
  const body = object(await request(`/api/v1/admin/round-rule-sets/${encodeURIComponent(ruleSetId)}`), 'Invalid rule set response');
  return ruleSetDetail(body.data);
}

export async function createRuleSet(stage: string, rules: RoundRuleSetRulesV1, reason: string): Promise<{ readonly id: string; readonly version: number; readonly rulesSha256: string }> {
  const body = object(await request('/api/v1/admin/round-rule-sets', {
    method: 'POST',
    body: JSON.stringify({ tournamentStage: stage, rules, reason }),
  }), 'Invalid rule set creation response');
  const data = object(body.data, 'Invalid rule set creation response');
  const version = Number(data.version);
  if (typeof data.id !== 'string' || !Number.isSafeInteger(version) || typeof data.rulesSha256 !== 'string') {
    throw new Error('Invalid rule set creation response');
  }
  return { id: data.id, version, rulesSha256: data.rulesSha256 };
}

export async function listRounds(stage: string): Promise<readonly RoundSummary[]> {
  const body = object(await request(`/api/v1/admin/rounds?tournamentStage=${encodeURIComponent(stage)}`), 'Invalid round list response');
  const data = object(body.data, 'Invalid round list response');
  if (!Array.isArray(data.items)) throw new Error('Invalid round list response');
  return data.items.map(roundSummary);
}

export async function getRound(roundId: string): Promise<RoundSummary> {
  const body = object(await request(`/api/v1/admin/rounds/${encodeURIComponent(roundId)}`), 'Invalid round response');
  return roundSummary(body.data);
}

export async function createRound(stage: string, reason: string): Promise<RoundSummary> {
  const body = object(await request('/api/v1/admin/rounds', {
    method: 'POST',
    body: JSON.stringify({ tournamentStage: stage, reason }),
  }), 'Invalid round creation response');
  return roundSummary(body.data);
}

export interface TransitionOptions {
  readonly reason: string;
  readonly ruleSetId?: string;
  readonly idempotencyKey?: string;
}

export async function transitionRound(roundId: string, action: RoundActionType, options: TransitionOptions): Promise<RoundSummary> {
  const headers: Record<string, string> = {};
  if (action === 'start') {
    if (!options.idempotencyKey) throw new Error('An idempotency key is required to start a round');
    headers['idempotency-key'] = options.idempotencyKey;
  }
  const payload: Record<string, string> = { reason: options.reason };
  if (options.ruleSetId !== undefined) payload.ruleSetId = options.ruleSetId;
  const body = object(await request(`/api/v1/admin/rounds/${encodeURIComponent(roundId)}/${action}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  }), 'Invalid round transition response');
  return roundSummary(body.data);
}

export async function listTeamsCount(): Promise<number> {
  const body = object(await request('/api/v1/admin/teams'), 'Invalid team list response');
  const data = body.data;
  if (!Array.isArray(data)) throw new Error('Invalid team list response');
  return data.length;
}
