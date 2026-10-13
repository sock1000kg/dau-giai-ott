export type TieBreakStatus = 'CLEAR' | 'BTC_REQUIRED';

export interface LeaderboardEntry {
  readonly rank: number;
  readonly tieBreakStatus: TieBreakStatus;
  readonly team: Readonly<{ id: string; name: string }>;
  readonly rating: number;
  readonly headToHeadPoints: number;
  readonly series: Readonly<{ wins: number; draws: number; losses: number }>;
  readonly winRate: number;
  readonly technicalFaultCount: number;
  readonly forfeitCount: number;
  readonly updatedAt: string;
}

export interface LeaderboardPageData {
  readonly items: readonly LeaderboardEntry[];
  readonly pagination: Readonly<{ page: number; pageSize: number; total: number; totalPages: number }>;
}

export class LeaderboardApiError extends Error {
  public readonly status: number;
  public constructor(status: number) { super('Leaderboard request failed'); this.name = 'LeaderboardApiError'; this.status = status; }
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid leaderboard response');
  return value as Record<string, unknown>;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function entry(value: unknown): LeaderboardEntry {
  const row = object(value);
  const team = object(row.team);
  const series = object(row.series);
  if (!Number.isSafeInteger(row.rank) || Number(row.rank) < 1
    || !(row.tieBreakStatus === 'CLEAR' || row.tieBreakStatus === 'BTC_REQUIRED')
    || typeof team.id !== 'string' || typeof team.name !== 'string'
    || !nonNegativeInteger(row.rating) || !Number.isFinite(row.headToHeadPoints) || Number(row.headToHeadPoints) < 0
    || !nonNegativeInteger(series.wins) || !nonNegativeInteger(series.draws) || !nonNegativeInteger(series.losses)
    || !Number.isFinite(row.winRate) || Number(row.winRate) < 0 || Number(row.winRate) > 1
    || !nonNegativeInteger(row.technicalFaultCount) || !nonNegativeInteger(row.forfeitCount)
    || typeof row.updatedAt !== 'string' || Number.isNaN(Date.parse(row.updatedAt))) throw new Error('Invalid leaderboard response');
  return {
    rank: Number(row.rank),
    tieBreakStatus: row.tieBreakStatus,
    team: { id: team.id, name: team.name },
    rating: Number(row.rating),
    headToHeadPoints: Number(row.headToHeadPoints),
    series: { wins: Number(series.wins), draws: Number(series.draws), losses: Number(series.losses) },
    winRate: Number(row.winRate),
    technicalFaultCount: Number(row.technicalFaultCount),
    forfeitCount: Number(row.forfeitCount),
    updatedAt: row.updatedAt,
  };
}

export async function listLeaderboard(options: { stage?: string; page?: number; pageSize?: number } = {}): Promise<LeaderboardPageData> {
  const query = new URLSearchParams({
    stage: options.stage ?? 'QUALIFICATION',
    page: String(options.page ?? 1),
    pageSize: String(options.pageSize ?? 25),
  });
  const response = await fetch(`/api/v1/leaderboard?${query}`, { credentials: 'include' });
  if (!response.ok) throw new LeaderboardApiError(response.status);
  const body = object(await response.json());
  const data = object(body.data);
  const pagination = object(data.pagination);
  if (!Array.isArray(data.items)
    || ![pagination.page, pagination.pageSize, pagination.total, pagination.totalPages].every(nonNegativeInteger)
    || Number(pagination.page) < 1 || Number(pagination.pageSize) < 1) throw new Error('Invalid leaderboard response');
  return {
    items: data.items.map(entry),
    pagination: { page: Number(pagination.page), pageSize: Number(pagination.pageSize), total: Number(pagination.total), totalPages: Number(pagination.totalPages) },
  };
}
