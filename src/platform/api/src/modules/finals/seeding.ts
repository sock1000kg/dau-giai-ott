import { createHash } from 'node:crypto';

import { DEFAULT_MINIMUM_FINALS_SERIES, finalsEligibility } from '../scheduling/eligibility.ts';

/**
 * P3-L06 finals seeding (Finals Format v1 §"Unique qualification seed", requirement 12 / D-23).
 *
 * Pure domain: no database, no clock. Order teams by Elo → series wins → game-point differential →
 * head-to-head when a bucket has exactly two teams → deterministic public draw from the committed
 * `drawSeed`. The result is locked: `verifyLockedSeeding` re-derives the hash so a later stage can
 * prove the bracket was built from the ranking that was published (AC-09).
 */

/** One rankable team as fed by the qualification flow (`P3-D08`), not read from the database here. */
export interface FinalsSeedCandidate {
  readonly teamId: string;
  readonly submissionId: string;
  readonly elo: number;
  readonly seriesWins: number;
  readonly gamePointDifferential: number;
  /** Finalized series that produced a rating ledger row; drives the D-22 minimum-series rule. */
  readonly ratedSeries: number;
}

/** Direct result between two teams; only consulted when a tie bucket holds exactly two teams. */
export interface HeadToHeadResult {
  readonly teamA: string;
  readonly teamB: string;
  readonly pointsA: number;
  readonly pointsB: number;
}

export interface FinalsSeedOptions {
  /** Committed and published before the draw; never derived from results. */
  readonly drawSeed: string;
  /** BTC may lower the D-22 threshold when a stage has fewer than six rounds; published up front. */
  readonly minimumSeries?: number;
  readonly headToHead?: readonly HeadToHeadResult[];
}

export interface LockedSeed {
  /** Unique ordinal 1..8; 1 is the best rank. */
  readonly ordinal: number;
  readonly teamId: string;
  readonly submissionId: string;
}

export interface LockedSeeding {
  readonly seeds: readonly LockedSeed[];
  readonly drawSeed: string;
  readonly minimumSeries: number;
  /** SHA-256 over the locked ordinals; recomputed by `verifyLockedSeeding`. */
  readonly seedingHash: string;
}

export interface ExcludedCandidate {
  readonly teamId: string;
  readonly ratedSeries: number;
  readonly shortfall: number;
}

export interface FinalsSeedingResult {
  readonly locked: LockedSeeding;
  /** Teams that qualified but stay out of the bracket because of the minimum-series rule. */
  readonly excluded: readonly ExcludedCandidate[];
}

function hashKey(drawSeed: string, teamId: string): string {
  return createHash('sha256').update(`${drawSeed}:${teamId}`).digest('hex');
}

function requireSafeInteger(value: number, code: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(code);
}

function compareTieBreak(a: FinalsSeedCandidate, b: FinalsSeedCandidate): number {
  return b.elo - a.elo || b.seriesWins - a.seriesWins || b.gamePointDifferential - a.gamePointDifferential;
}

function headToHeadWinner(
  left: FinalsSeedCandidate,
  right: FinalsSeedCandidate,
  headToHead: readonly HeadToHeadResult[],
): FinalsSeedCandidate | null {
  for (const result of headToHead) {
    const forward = result.teamA === left.teamId && result.teamB === right.teamId;
    const reverse = result.teamA === right.teamId && result.teamB === left.teamId;
    if (!forward && !reverse) continue;
    const leftPoints = forward ? result.pointsA : result.pointsB;
    const rightPoints = forward ? result.pointsB : result.pointsA;
    if (leftPoints === rightPoints) continue;
    return leftPoints > rightPoints ? left : right;
  }
  return null;
}

function resolveBucket(
  bucket: readonly FinalsSeedCandidate[],
  drawSeed: string,
  headToHead: readonly HeadToHeadResult[],
): FinalsSeedCandidate[] {
  if (bucket.length <= 1) return [...bucket];
  if (bucket.length === 2) {
    const [left, right] = bucket as readonly [FinalsSeedCandidate, FinalsSeedCandidate];
    const winner = headToHeadWinner(left, right, headToHead);
    if (winner !== null) return winner === left ? [left, right] : [right, left];
  }
  return [...bucket].sort((a, b) => {
    const keyA = hashKey(drawSeed, a.teamId);
    const keyB = hashKey(drawSeed, b.teamId);
    return keyA < keyB ? -1 : keyA > keyB ? 1 : a.teamId < b.teamId ? -1 : 1;
  });
}

export function seedingHashOf(seeds: readonly LockedSeed[]): string {
  const canonical = seeds.map(({ ordinal, teamId, submissionId }) => `${ordinal}:${teamId}:${submissionId}`).join('|');
  return createHash('sha256').update(canonical).digest('hex');
}

/** Re-derives the hash of an already locked seeding; a mismatch means the bracket drifted (AC-09). */
export function verifyLockedSeeding(locked: LockedSeeding): boolean {
  return seedingHashOf(locked.seeds) === locked.seedingHash;
}

/**
 * Produces the unique ordinal `1..8` from the published qualification order. Ineligible teams
 * (fewer than `minimumSeries` rated series) are reported back instead of silently ranked, and the
 * bracket is refused unless exactly eight teams remain.
 */
export function seedFinals(
  candidates: readonly FinalsSeedCandidate[],
  options: FinalsSeedOptions,
): FinalsSeedingResult {
  const { drawSeed } = options;
  const minimumSeries = options.minimumSeries ?? DEFAULT_MINIMUM_FINALS_SERIES;
  const headToHead = options.headToHead ?? [];
  if (typeof drawSeed !== 'string' || drawSeed.length === 0) throw new Error('FINALS_DRAW_SEED_INVALID');
  if (new Set(candidates.map(({ teamId }) => teamId)).size !== candidates.length) {
    throw new Error('FINALS_CANDIDATE_DUPLICATE');
  }
  if (new Set(candidates.map(({ submissionId }) => submissionId)).size !== candidates.length) {
    throw new Error('FINALS_CANDIDATE_DUPLICATE');
  }

  const excluded: ExcludedCandidate[] = [];
  const eligible: FinalsSeedCandidate[] = [];
  for (const candidate of candidates) {
    requireSafeInteger(candidate.elo, 'FINALS_CANDIDATE_INVALID');
    requireSafeInteger(candidate.seriesWins, 'FINALS_CANDIDATE_INVALID');
    requireSafeInteger(candidate.gamePointDifferential, 'FINALS_CANDIDATE_INVALID');
    const eligibility = finalsEligibility({ ratedSeries: candidate.ratedSeries, minimumSeries });
    if (eligibility.eligible) {
      eligible.push(candidate);
    } else {
      excluded.push({
        teamId: candidate.teamId,
        ratedSeries: eligibility.ratedSeries,
        shortfall: eligibility.shortfall,
      });
    }
  }
  if (eligible.length !== 8) throw new Error('FINALS_SEED_COUNT_INVALID');

  const ordered = [...eligible].sort(compareTieBreak);
  const ranking: FinalsSeedCandidate[] = [];
  for (let index = 0; index < ordered.length;) {
    const anchor = ordered[index]!;
    const bucket: FinalsSeedCandidate[] = [anchor];
    let next = index + 1;
    while (next < ordered.length && compareTieBreak(anchor, ordered[next]!) === 0) {
      bucket.push(ordered[next]!);
      next += 1;
    }
    ranking.push(...resolveBucket(bucket, drawSeed, headToHead));
    index = next;
  }

  const seeds: LockedSeed[] = ranking.map((candidate, index) => ({
    ordinal: index + 1,
    teamId: candidate.teamId,
    submissionId: candidate.submissionId,
  }));
  const locked: LockedSeeding = Object.freeze({
    seeds: Object.freeze(seeds.map((seed) => Object.freeze(seed))),
    drawSeed,
    minimumSeries,
    seedingHash: seedingHashOf(seeds),
  });
  return { locked, excluded: Object.freeze(excluded.map((entry) => Object.freeze(entry))) };
}
