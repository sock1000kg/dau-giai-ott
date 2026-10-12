import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/client.ts';
import { requireAuthenticated, requireTeamAccess } from '../auth/authorize.ts';
import type { SessionPrincipal } from '../auth/types.ts';

export interface ResultRoutesOptions {
  readonly database: Database;
}

interface ResultQuery {
  readonly stage?: unknown;
  readonly teamId?: unknown;
  readonly page?: unknown;
  readonly pageSize?: unknown;
}

interface PageRow {
  readonly total_count: string;
}

interface MatchResultRow extends PageRow {
  readonly match_id: string;
  readonly series_id: string;
  readonly tournament_stage: string;
  readonly game_number: number;
  readonly status: string;
  readonly x_team_id: string;
  readonly x_team_name: string;
  readonly o_team_id: string;
  readonly o_team_name: string;
  readonly winner_team_id: string | null;
  readonly winner_side: 'X' | 'O' | null;
  readonly reason: string | null;
  readonly turn_count: number | null;
  readonly finalized_at: Date | null;
}

interface SeriesResultRow extends PageRow {
  readonly series_id: string;
  readonly tournament_stage: string;
  readonly status: string;
  readonly format: string;
  readonly team_a_id: string;
  readonly team_a_name: string;
  readonly team_b_id: string;
  readonly team_b_name: string;
  readonly team_a_score: string | null;
  readonly team_b_score: string | null;
  readonly winner_team_id: string | null;
  readonly cancellation_reason: string | null;
  readonly finalized_at: Date | null;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stagePattern = /^[A-Z][A-Z0-9_]{0,63}$/;

function positiveInteger(value: unknown, fallback: number, maximum: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : null;
}

function queryFilters(
  principal: SessionPrincipal,
  query: ResultQuery,
): { readonly stage: string | null; readonly scopeTeamId: string | null; readonly teamFilter: string | null; readonly page: number; readonly pageSize: number } | null {
  const stage = query.stage === undefined ? null : query.stage;
  if (stage !== null && (typeof stage !== 'string' || !stagePattern.test(stage))) return null;
  const page = positiveInteger(query.page, 1, 10000);
  const pageSize = positiveInteger(query.pageSize, 25, 100);
  if (page === null || pageSize === null) return null;

  let teamFilter: string | null = null;
  if (query.teamId !== undefined) {
    if (typeof query.teamId !== 'string' || !uuidPattern.test(query.teamId)) return null;
    requireTeamAccess(principal, query.teamId);
    if (principal.role === 'BTC_ADMIN') teamFilter = query.teamId;
  }
  return {
    stage,
    scopeTeamId: principal.role === 'TEAM_ACCOUNT' ? principal.teamId : null,
    teamFilter,
    page,
    pageSize,
  };
}

const matchWhere = `
  ($1::uuid IS NULL OR sx.team_id = $1 OR so.team_id = $1)
  AND ($2::text IS NULL OR s.tournament_stage = $2)
  AND ($3::uuid IS NULL OR sx.team_id = $3 OR so.team_id = $3)
  AND m.status IN ('FINALIZED', 'FAILED', 'CANCELLED')`;

const matchSql = `
  SELECT COUNT(*) OVER ()::text AS total_count,
    m.id AS match_id, s.id AS series_id, s.tournament_stage, m.game_number, m.status,
    sx.team_id AS x_team_id, tx.name AS x_team_name,
    so.team_id AS o_team_id, too.name AS o_team_name,
    CASE result.winner_side WHEN 'X' THEN sx.team_id WHEN 'O' THEN so.team_id END AS winner_team_id,
    result.winner_side, result.reason, result.turn_count, result.finalized_at
  FROM matches m
  JOIN series s ON s.id = m.series_id
  JOIN submissions sx ON sx.id = m.x_submission_id
  JOIN teams tx ON tx.id = sx.team_id
  JOIN submissions so ON so.id = m.o_submission_id
  JOIN teams too ON too.id = so.team_id
  LEFT JOIN match_results result ON result.match_id = m.id
  WHERE ${matchWhere}
  ORDER BY COALESCE(result.finalized_at, m.created_at) DESC, m.id DESC
  LIMIT $4 OFFSET $5`;

const matchCountSql = `
  SELECT COUNT(*)::text AS total_count
  FROM matches m
  JOIN series s ON s.id = m.series_id
  JOIN submissions sx ON sx.id = m.x_submission_id
  JOIN submissions so ON so.id = m.o_submission_id
  WHERE ${matchWhere}`;

const seriesWhere = `
  ($1::uuid IS NULL OR s.team_a_id = $1 OR s.team_b_id = $1)
  AND ($2::text IS NULL OR s.tournament_stage = $2)
  AND ($3::uuid IS NULL OR s.team_a_id = $3 OR s.team_b_id = $3)
  AND s.status IN ('FINALIZED', 'CANCELLED')`;

const seriesSql = `
  SELECT COUNT(*) OVER ()::text AS total_count,
    s.id AS series_id, s.tournament_stage, s.status, s.format,
    s.team_a_id, ta.name AS team_a_name, s.team_b_id, tb.name AS team_b_name,
    s.team_a_score, s.team_b_score, s.winner_team_id, s.cancellation_reason, s.finalized_at
  FROM series s
  JOIN teams ta ON ta.id = s.team_a_id
  JOIN teams tb ON tb.id = s.team_b_id
  WHERE ${seriesWhere}
  ORDER BY COALESCE(s.finalized_at, s.created_at) DESC, s.id DESC
  LIMIT $4 OFFSET $5`;

const seriesCountSql = `
  SELECT COUNT(*)::text AS total_count
  FROM series s
  WHERE ${seriesWhere} AND s.team_a_id IS NOT NULL AND s.team_b_id IS NOT NULL`;

async function totalCount(database: Database, sql: string, filters: readonly unknown[]): Promise<number> {
  const result = await database.query<PageRow>(sql, filters);
  return Number(result.rows[0]?.total_count ?? 0);
}

export function registerResultRoutes(app: FastifyInstance, options: ResultRoutesOptions): void {
  app.get<{ Querystring: ResultQuery }>('/api/v1/results/matches', async (request, reply) => {
    const principal = requireAuthenticated(request.principal);
    const filters = queryFilters(principal, request.query);
    if (filters === null) return reply.status(400).send({ error: { code: 'INVALID_QUERY', message: 'Invalid results query' } });
    const values = [filters.scopeTeamId, filters.stage, filters.teamFilter];
    const result = await options.database.query<MatchResultRow>(matchSql, [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]);
    const total = result.rows.length > 0
      ? Number(result.rows[0]!.total_count)
      : await totalCount(options.database, matchCountSql, values);
    return {
      data: {
        items: result.rows.map((row) => ({
          matchId: row.match_id,
          seriesId: row.series_id,
          stage: row.tournament_stage,
          gameNumber: row.game_number,
          status: row.status,
          teams: { x: { id: row.x_team_id, name: row.x_team_name }, o: { id: row.o_team_id, name: row.o_team_name } },
          winnerTeamId: row.winner_team_id,
          winnerSide: row.winner_side,
          reason: row.reason,
          turnCount: row.turn_count,
          finalizedAt: row.finalized_at,
        })),
        pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
      },
    };
  });

  app.get<{ Querystring: ResultQuery }>('/api/v1/results/series', async (request, reply) => {
    const principal = requireAuthenticated(request.principal);
    const filters = queryFilters(principal, request.query);
    if (filters === null) return reply.status(400).send({ error: { code: 'INVALID_QUERY', message: 'Invalid results query' } });
    const values = [filters.scopeTeamId, filters.stage, filters.teamFilter];
    const result = await options.database.query<SeriesResultRow>(seriesSql, [...values, filters.pageSize, (filters.page - 1) * filters.pageSize]);
    const total = result.rows.length > 0
      ? Number(result.rows[0]!.total_count)
      : await totalCount(options.database, seriesCountSql, values);
    return {
      data: {
        items: result.rows.map((row) => ({
          seriesId: row.series_id,
          stage: row.tournament_stage,
          status: row.status,
          format: row.format,
          teams: { a: { id: row.team_a_id, name: row.team_a_name }, b: { id: row.team_b_id, name: row.team_b_name } },
          score: { a: row.team_a_score === null ? null : Number(row.team_a_score), b: row.team_b_score === null ? null : Number(row.team_b_score) },
          winnerTeamId: row.winner_team_id,
          cancellationReason: row.cancellation_reason,
          finalizedAt: row.finalized_at,
        })),
        pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) },
      },
    };
  });
}
