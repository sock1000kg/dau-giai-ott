export type ResultFaultSummary = Readonly<{
  recoverableTotal: number;
  recoverableConsecutive: number;
  lastErrorCode: string | null;
}>;

export interface MatchResult {
  readonly matchId: string;
  readonly seriesId: string;
  readonly stage: string;
  readonly gameNumber: number;
  readonly status: string;
  readonly teams: Readonly<{ x: { id: string; name: string }; o: { id: string; name: string } }>;
  readonly winnerTeamId: string | null;
  readonly winnerSide: 'X' | 'O' | null;
  readonly reason: string | null;
  readonly turnCount: number | null;
  readonly finalizedAt: string | null;
  readonly faults: Readonly<{ X: ResultFaultSummary; O: ResultFaultSummary }> | null;
}

export interface SeriesResult {
  readonly seriesId: string;
  readonly stage: string;
  readonly status: string;
  readonly format: string;
  readonly teams: Readonly<{ a: { id: string; name: string }; b: { id: string; name: string } }>;
  readonly score: Readonly<{ a: number | null; b: number | null }>;
  readonly winnerTeamId: string | null;
  readonly cancellationReason: string | null;
  readonly finalizedAt: string | null;
}

export interface ResultPage<T> {
  readonly items: readonly T[];
  readonly pagination: Readonly<{ page: number; pageSize: number; total: number; totalPages: number }>;
}

export class ResultsApiError extends Error {
  public readonly status: number;
  public constructor(status: number) { super('Results request failed'); this.name = 'ResultsApiError'; this.status = status; }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid results response');
  return value as Record<string, unknown>;
}

function fault(value: unknown): ResultFaultSummary {
  const row = object(value);
  if (!Number.isSafeInteger(row.recoverableTotal) || Number(row.recoverableTotal) < 0
    || !Number.isSafeInteger(row.recoverableConsecutive) || Number(row.recoverableConsecutive) < 0
    || !(row.lastErrorCode === null || typeof row.lastErrorCode === 'string')) throw new Error('Invalid results response');
  return { recoverableTotal: Number(row.recoverableTotal), recoverableConsecutive: Number(row.recoverableConsecutive), lastErrorCode: row.lastErrorCode as string | null };
}

function team(value: unknown) {
  const row = object(value);
  if (typeof row.id !== 'string' || typeof row.name !== 'string') throw new Error('Invalid results response');
  return { id: row.id, name: row.name };
}

function match(value: unknown): MatchResult {
  const row = object(value);
  const teams = object(row.teams);
  if (typeof row.matchId !== 'string' || typeof row.seriesId !== 'string' || typeof row.stage !== 'string'
    || !Number.isSafeInteger(row.gameNumber) || typeof row.status !== 'string'
    || !(row.winnerSide === null || row.winnerSide === 'X' || row.winnerSide === 'O')
    || !(row.winnerTeamId === null || typeof row.winnerTeamId === 'string')
    || !(row.reason === null || typeof row.reason === 'string')
    || !(row.turnCount === null || Number.isSafeInteger(row.turnCount))
    || !(row.finalizedAt === null || typeof row.finalizedAt === 'string')) throw new Error('Invalid results response');
  const faults = row.faults === null ? null : object(row.faults);
  return { matchId: row.matchId, seriesId: row.seriesId, stage: row.stage, gameNumber: Number(row.gameNumber), status: row.status, teams: { x: team(teams.x), o: team(teams.o) }, winnerTeamId: row.winnerTeamId as string | null, winnerSide: row.winnerSide, reason: row.reason as string | null, turnCount: row.turnCount as number | null, finalizedAt: row.finalizedAt as string | null, faults: faults === null ? null : { X: fault(faults.X), O: fault(faults.O) } };
}

function series(value: unknown): SeriesResult {
  const row = object(value); const teams = object(row.teams); const score = object(row.score);
  if (typeof row.seriesId !== 'string' || typeof row.stage !== 'string' || typeof row.status !== 'string' || typeof row.format !== 'string'
    || !(row.winnerTeamId === null || typeof row.winnerTeamId === 'string')
    || !(row.cancellationReason === null || typeof row.cancellationReason === 'string')
    || !(score.a === null || Number.isSafeInteger(score.a)) || !(score.b === null || Number.isSafeInteger(score.b))) throw new Error('Invalid results response');
  return { seriesId: row.seriesId, stage: row.stage, status: row.status, format: row.format, teams: { a: team(teams.a), b: team(teams.b) }, score: { a: score.a as number | null, b: score.b as number | null }, winnerTeamId: row.winnerTeamId as string | null, cancellationReason: row.cancellationReason as string | null, finalizedAt: typeof row.finalizedAt === 'string' ? row.finalizedAt : null };
}

export async function listResults(kind: 'matches', options: { page: number; pageSize: number; teamId?: string; stage?: string }): Promise<ResultPage<MatchResult>>;
export async function listResults(kind: 'series', options: { page: number; pageSize: number; teamId?: string; stage?: string }): Promise<ResultPage<SeriesResult>>;
export async function listResults(kind: 'matches' | 'series', options: { page: number; pageSize: number; teamId?: string; stage?: string }): Promise<ResultPage<MatchResult> | ResultPage<SeriesResult>> {
  const query = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize) });
  if (options.teamId !== undefined) query.set('teamId', options.teamId);
  if (options.stage !== undefined && options.stage !== '') query.set('stage', options.stage);
  const response = await fetch(`/api/v1/results/${kind}?${query}`, { credentials: 'include' });
  if (!response.ok) throw new ResultsApiError(response.status);
  const body = object(await response.json()); const data = object(body.data); const pagination = object(data.pagination);
  if (!Array.isArray(data.items) || ![pagination.page, pagination.pageSize, pagination.total, pagination.totalPages].every((value) => Number.isSafeInteger(value) && Number(value) >= 0)) throw new Error('Invalid results response');
  const paginationResult = { page: Number(pagination.page), pageSize: Number(pagination.pageSize), total: Number(pagination.total), totalPages: Number(pagination.totalPages) };
  if (kind === 'matches') return { items: data.items.map(match), pagination: paginationResult };
  return { items: data.items.map(series), pagination: paginationResult };
}

export async function listResultTeams(): Promise<readonly { id: string; name: string }[]> {
  const response = await fetch('/api/v1/admin/teams', { credentials: 'include' });
  if (!response.ok) throw new ResultsApiError(response.status);
  const body = object(await response.json());
  if (!Array.isArray(body.data)) throw new Error('Invalid results response');
  return body.data.map(team);
}
