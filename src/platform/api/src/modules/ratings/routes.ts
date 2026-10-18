import type { FastifyInstance } from 'fastify';
import type { Database } from '../../db/client.ts';
import { DEFAULT_MINIMUM_FINALS_SERIES, finalsEligibility, MAX_MINIMUM_FINALS_SERIES, ratingStatusFor } from '../scheduling/eligibility.ts';

export interface LeaderboardRoutesOptions {
  readonly database: Database;
}

interface LeaderboardQuery {
  readonly stage?: unknown;
  readonly page?: unknown;
  readonly pageSize?: unknown;
  readonly minimumSeries?: unknown;
}

export interface LeaderboardRow {
  readonly rank: string;
  readonly tie_count: string;
  readonly total_count: string;
  readonly team_id: string;
  readonly team_name: string;
  readonly rating: number;
  readonly head_to_head_points: string;
  readonly series_wins: number;
  readonly series_draws: number;
  readonly series_losses: number;
  readonly win_rate: string;
  readonly technical_fault_count: number;
  readonly forfeit_count: number;
  readonly updated_at: Date;
}

export const leaderboardSql = `
WITH participants AS (
  SELECT DISTINCT rp.team_id
  FROM round_participants rp
  JOIN rounds r ON r.id = rp.round_id
  WHERE r.tournament_stage = $1
),
latest_rating AS (
  SELECT DISTINCT ON (ledger.team_id) ledger.team_id, ledger.rating_after, ledger.created_at
  FROM rating_ledger ledger
  JOIN series rated_series ON rated_series.id = ledger.series_id
  ORDER BY ledger.team_id, rated_series.created_at DESC, ledger.created_at DESC, ledger.id DESC
),
stage_teams AS (
  SELECT t.id AS team_id, t.name AS team_name,
    COALESCE(latest.rating_after, 1000)::integer AS rating,
    COALESCE(latest.created_at, t.created_at) AS rating_updated_at
  FROM participants p
  JOIN teams t ON t.id = p.team_id
  LEFT JOIN latest_rating latest ON latest.team_id = t.id
),
stage_series AS (
  SELECT s.id, s.team_a_id, s.team_b_id, s.team_a_score, s.team_b_score, s.finalized_at
  FROM series s
  WHERE s.tournament_stage = $1 AND s.status = 'FINALIZED'
),
team_series AS (
  SELECT id AS series_id, team_a_id AS team_id, team_b_id AS opponent_id,
    team_a_score AS points, finalized_at
  FROM stage_series
  UNION ALL
  SELECT id, team_b_id, team_a_id, team_b_score, finalized_at
  FROM stage_series
),
records AS (
  SELECT team_id,
    COUNT(*) FILTER (WHERE points > 1)::integer AS wins,
    COUNT(*) FILTER (WHERE points = 1)::integer AS draws,
    COUNT(*) FILTER (WHERE points < 1)::integer AS losses,
    MAX(finalized_at) AS last_result_at
  FROM team_series
  GROUP BY team_id
),
head_to_head AS (
  SELECT results.team_id, SUM(results.points) AS points
  FROM team_series results
  JOIN stage_teams own ON own.team_id = results.team_id
  JOIN stage_teams opponent ON opponent.team_id = results.opponent_id AND opponent.rating = own.rating
  GROUP BY results.team_id
),
technical_faults AS (
  SELECT CASE events.payload->>'side'
      WHEN 'X' THEN sx.team_id
      WHEN 'O' THEN so.team_id
    END AS team_id,
    COUNT(*)::integer AS fault_count
  FROM match_events events
  JOIN matches m ON m.id = events.match_id
  JOIN stage_series s ON s.id = m.series_id
  JOIN submissions sx ON sx.id = m.x_submission_id
  JOIN submissions so ON so.id = m.o_submission_id
  WHERE events.event_type = 'TURN_SKIPPED'
    AND events.payload->>'reason' IS DISTINCT FROM 'NO_LEGAL_ACTION'
  GROUP BY 1
),
forfeits AS (
  SELECT CASE result.winner_side
      WHEN 'X' THEN so.team_id
      WHEN 'O' THEN sx.team_id
    END AS team_id,
    COUNT(*)::integer AS forfeit_count
  FROM match_results result
  JOIN matches m ON m.id = result.match_id
  JOIN stage_series s ON s.id = m.series_id
  JOIN submissions sx ON sx.id = m.x_submission_id
  JOIN submissions so ON so.id = m.o_submission_id
  WHERE result.reason = 'FORFEIT' AND result.winner_side IS NOT NULL
  GROUP BY 1
),
metrics AS (
  SELECT t.team_id, t.team_name, t.rating,
    COALESCE(h2h.points, 0)::numeric AS head_to_head_points,
    COALESCE(record.wins, 0)::integer AS series_wins,
    COALESCE(record.draws, 0)::integer AS series_draws,
    COALESCE(record.losses, 0)::integer AS series_losses,
    CASE WHEN COALESCE(record.wins, 0) + COALESCE(record.draws, 0) + COALESCE(record.losses, 0) = 0
      THEN 0::numeric
      ELSE record.wins::numeric / (record.wins + record.draws + record.losses)
    END AS win_rate,
    COALESCE(fault.fault_count, 0)::integer AS technical_fault_count,
    COALESCE(forfeit.forfeit_count, 0)::integer AS forfeit_count,
    GREATEST(t.rating_updated_at, COALESCE(record.last_result_at, t.rating_updated_at)) AS updated_at
  FROM stage_teams t
  LEFT JOIN records record ON record.team_id = t.team_id
  LEFT JOIN head_to_head h2h ON h2h.team_id = t.team_id
  LEFT JOIN technical_faults fault ON fault.team_id = t.team_id
  LEFT JOIN forfeits forfeit ON forfeit.team_id = t.team_id
),
ranked AS (
  SELECT metrics.*,
    RANK() OVER (ORDER BY rating DESC, head_to_head_points DESC, win_rate DESC,
      (technical_fault_count + forfeit_count) ASC) AS rank,
    COUNT(*) OVER (PARTITION BY rating, head_to_head_points, win_rate,
      (technical_fault_count + forfeit_count)) AS tie_count,
    COUNT(*) OVER () AS total_count
  FROM metrics
)
SELECT rank::text, tie_count::text, total_count::text, team_id, team_name, rating,
  head_to_head_points::text, series_wins, series_draws, series_losses, win_rate::text,
  technical_fault_count, forfeit_count, updated_at
FROM ranked
ORDER BY rank, team_id
LIMIT $2 OFFSET $3`;

function validStage(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(value);
}

function integerQuery(value: unknown, fallback: number, min: number, max: number): number | null {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

export function registerLeaderboardRoutes(app: FastifyInstance, options: LeaderboardRoutesOptions): void {
  app.get<{ Querystring: LeaderboardQuery }>('/api/v1/leaderboard', async (request, reply) => {
    const query = request.query;
    const stage = query.stage === undefined ? 'QUALIFICATION' : query.stage;
    const page = integerQuery(query.page, 1, 1, 10000);
    const pageSize = integerQuery(query.pageSize, 25, 1, 100);
    const minimumSeries = integerQuery(query.minimumSeries, DEFAULT_MINIMUM_FINALS_SERIES, 1, MAX_MINIMUM_FINALS_SERIES);
    if (!validStage(stage) || page === null || pageSize === null || minimumSeries === null) {
      return reply.status(400).send({ error: { code: 'INVALID_QUERY', message: 'Invalid leaderboard query' } });
    }
    const offset = (page - 1) * pageSize;
    const result = await options.database.query<LeaderboardRow>(leaderboardSql, [stage, pageSize, offset]);
    let total = Number(result.rows[0]?.total_count ?? 0);
    if (result.rows.length === 0 && page > 1) {
      const count = await options.database.query<{ readonly total: string }>(
        'SELECT COUNT(DISTINCT rp.team_id)::text AS total FROM round_participants rp JOIN rounds r ON r.id = rp.round_id WHERE r.tournament_stage = $1', [stage],
      );
      total = Number(count.rows[0]?.total ?? 0);
    }
    return {
      data: {
        items: result.rows.map((row) => {
          const ratedSeries = row.series_wins + row.series_draws + row.series_losses;
          const eligibility = finalsEligibility({ ratedSeries, minimumSeries });
          return {
            rank: Number(row.rank),
            tieBreakStatus: Number(row.tie_count) > 1 ? 'BTC_REQUIRED' : 'CLEAR',
            team: { id: row.team_id, name: row.team_name },
            rating: row.rating,
            headToHeadPoints: Number(row.head_to_head_points),
            series: { wins: row.series_wins, draws: row.series_draws, losses: row.series_losses },
            winRate: Number(row.win_rate),
            technicalFaultCount: row.technical_fault_count,
            forfeitCount: row.forfeit_count,
            updatedAt: row.updated_at,
            ratedSeries,
            finalsEligible: eligibility.eligible,
            ratingStatus: ratingStatusFor(eligibility),
          };
        }),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      },
    };
  });
}
