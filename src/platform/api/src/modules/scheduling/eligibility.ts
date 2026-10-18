import type { Database } from '../../db/client.ts';

/** Decision D-22 / requirement 11.5: finals need at least five finalized (rated) series by default. */
export const DEFAULT_MINIMUM_FINALS_SERIES = 5;
export const MAX_MINIMUM_FINALS_SERIES = 50;

export interface FinalsEligibility {
  readonly eligible: boolean;
  readonly ratedSeries: number;
  readonly minimumSeries: number;
  readonly shortfall: number;
}

/** Rated series are series that produced a ledger row; cancelled or infra-failed series never count. */
export function ratedSeriesCount(series: readonly { readonly status: string }[]): number {
  return series.filter(({ status }) => status === 'FINALIZED').length;
}

/**
 * `minimumSeries` is supplied by the caller: BTC lowers and publishes it when a stage has fewer than six
 * rounds. Per-stage storage of that threshold belongs to the D08 finals flow, not to this module.
 */
export function finalsEligibility(input: { readonly ratedSeries: number; readonly minimumSeries: number }): FinalsEligibility {
  const { ratedSeries, minimumSeries } = input;
  if (!Number.isSafeInteger(ratedSeries) || ratedSeries < 0) throw new Error('RATED_SERIES_INVALID');
  if (!Number.isSafeInteger(minimumSeries) || minimumSeries < 1) throw new Error('MINIMUM_SERIES_INVALID');
  return { eligible: ratedSeries >= minimumSeries, ratedSeries, minimumSeries, shortfall: Math.max(0, minimumSeries - ratedSeries) };
}

export type RatingStatus = 'RANKED' | 'UNRANKED_MIN_SERIES';

export function ratingStatusFor(eligibility: FinalsEligibility): RatingStatus {
  return eligibility.eligible ? 'RANKED' : 'UNRANKED_MIN_SERIES';
}

/** Environment flag: when true, submissions without a PASS gate result are excluded from round pools. */
export function isQualificationGateEnforced(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.OTT_QUALIFICATION_GATE_ENFORCED === 'true';
}

export async function isSubmissionRankable(database: Database, submissionId: string): Promise<boolean> {
  const result = await database.query(
    "SELECT 1 FROM submission_gate_results WHERE submission_id = $1 AND outcome = 'PASS' LIMIT 1", [submissionId],
  );
  return result.rows.length > 0;
}
