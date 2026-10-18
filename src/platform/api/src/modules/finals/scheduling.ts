import { createHash } from 'node:crypto';

import type { LockedSeeding, LockedSeed } from './seeding.ts';

/**
 * P3-L06 finals bracket and series scheduling (Finals Format v1, requirement 12 / D-23).
 *
 * Pure domain: every decision is derived from the locked seeding, the committed series seed and the
 * pinned rule set. Nothing here reads a clock or the database, so the same inputs always produce the
 * same bracket, the same side order and the same map order.
 */

export type FinalsRound = 'QUARTERFINAL' | 'SEMIFINAL' | 'FINAL' | 'BRONZE';

export type FinalsSide = 'X' | 'O';

/** A bracket slot is either a fixed seed ordinal or the winner/loser of an earlier pairing. */
export type PairingSlot =
  | { readonly kind: 'SEED'; readonly seed: number }
  | { readonly kind: 'WINNER'; readonly pairingId: string }
  | { readonly kind: 'LOSER'; readonly pairingId: string };

export interface FinalsPairing {
  readonly id: string;
  readonly round: FinalsRound;
  readonly slot: number;
  readonly home: PairingSlot;
  readonly away: PairingSlot;
}

export interface FinalsBracket {
  readonly seeds: readonly LockedSeed[];
  readonly bronzeMatchEnabled: boolean;
  readonly pairings: readonly FinalsPairing[];
}

export interface FinalsBracketOptions {
  /** Finals Format v1: configurable, defaults to `true`. */
  readonly bronzeMatchEnabled?: boolean;
}

/** Finals Format v1 §Bracket: quarterfinal pairs are fixed, not drawn. */
export const QUARTERFINAL_SEED_PAIRS: readonly (readonly [number, number])[] = [
  [1, 8],
  [4, 5],
  [2, 7],
  [3, 6],
];

export const FINALS_BEST_OF = 3;
/** Requirement 12.1 PoC default: 30 minutes of wall-clock per pairing. */
export const DEFAULT_PAIRING_WALL_CLOCK_MS = 30 * 60 * 1000;

function seedSlot(seed: number): PairingSlot {
  return { kind: 'SEED', seed };
}

function winnerOf(pairingId: string): PairingSlot {
  return { kind: 'WINNER', pairingId };
}

function loserOf(pairingId: string): PairingSlot {
  return { kind: 'LOSER', pairingId };
}

/**
 * Builds the fixed single-elimination bracket: quarterfinals from the locked ordinals, then
 * semifinals inside the two halves (`QF1/QF2` and `QF3/QF4`), the final, and the optional bronze
 * match between the semifinal losers.
 */
export function createFinalsBracket(locked: LockedSeeding, options: FinalsBracketOptions = {}): FinalsBracket {
  if (locked.seeds.length !== 8) throw new Error('FINALS_SEED_COUNT_INVALID');
  const ordinals = new Set(locked.seeds.map(({ ordinal }) => ordinal));
  if (ordinals.size !== 8 || [...ordinals].some((ordinal) => ordinal < 1 || ordinal > 8)) {
    throw new Error('FINALS_SEED_INVALID');
  }

  const pairings: FinalsPairing[] = QUARTERFINAL_SEED_PAIRS.map(([home, away], index) => ({
    id: `QF${index + 1}`,
    round: 'QUARTERFINAL' as const,
    slot: index + 1,
    home: seedSlot(home),
    away: seedSlot(away),
  }));
  pairings.push(
    { id: 'SF1', round: 'SEMIFINAL', slot: 1, home: winnerOf('QF1'), away: winnerOf('QF2') },
    { id: 'SF2', round: 'SEMIFINAL', slot: 2, home: winnerOf('QF3'), away: winnerOf('QF4') },
    { id: 'F1', round: 'FINAL', slot: 1, home: winnerOf('SF1'), away: winnerOf('SF2') },
  );
  const bronzeMatchEnabled = options.bronzeMatchEnabled ?? true;
  if (bronzeMatchEnabled) {
    pairings.push({ id: 'B1', round: 'BRONZE', slot: 1, home: loserOf('SF1'), away: loserOf('SF2') });
  }

  return Object.freeze({
    seeds: locked.seeds,
    bronzeMatchEnabled,
    pairings: Object.freeze(pairings.map((pairing) => Object.freeze(pairing))),
  });
}

export interface FinalsGamePlan {
  readonly game: number;
  readonly homeSide: FinalsSide;
  readonly awaySide: FinalsSide;
  readonly mapId: string;
}

export interface SeriesPlanInput {
  /** Committed before the series and published with it; drives game-3 side and the map order. */
  readonly seriesSeed: string;
  /** Locked map pool; a map cannot repeat inside one series until the pool is exhausted. */
  readonly mapPool: readonly string[];
  readonly bestOf?: number;
}

function parity(seed: string, purpose: string): number {
  return createHash('sha256').update(`${seed}:${purpose}`).digest()[0]! % 2;
}

/**
 * Plans the BO3 games of one pairing. Games 1 and 2 swap sides; the deciding game takes its side
 * from the committed series seed. The locked map pool is ordered by a keyed hash of the same seed,
 * so the selection order stays secret until the seed is published while never repeating a map
 * before the pool is exhausted.
 */
export function planSeriesGames(input: SeriesPlanInput): readonly FinalsGamePlan[] {
  const bestOf = input.bestOf ?? FINALS_BEST_OF;
  if (bestOf !== FINALS_BEST_OF) throw new Error('FINALS_BEST_OF_INVALID');
  if (typeof input.seriesSeed !== 'string' || input.seriesSeed.length === 0) {
    throw new Error('FINALS_SERIES_SEED_INVALID');
  }
  const pool = input.mapPool;
  if (pool.length === 0) throw new Error('FINALS_MAP_POOL_EMPTY');
  if (new Set(pool).size !== pool.length) throw new Error('FINALS_MAP_POOL_DUPLICATE');
  if (pool.some((mapId) => typeof mapId !== 'string' || mapId.length === 0)) throw new Error('FINALS_MAP_POOL_INVALID');

  const orderedPool = [...pool].sort((a, b) => {
    const keyA = createHash('sha256').update(`${input.seriesSeed}:map:${a}`).digest('hex');
    const keyB = createHash('sha256').update(`${input.seriesSeed}:map:${b}`).digest('hex');
    return keyA < keyB ? -1 : keyA > keyB ? 1 : a < b ? -1 : 1;
  });
  const game3HomeIsX = parity(input.seriesSeed, 'side') === 0;

  const games: FinalsGamePlan[] = [];
  for (let game = 1; game <= bestOf; game += 1) {
    const homeSide: FinalsSide = game === 1 ? 'X' : game === 2 ? 'O' : game3HomeIsX ? 'X' : 'O';
    games.push({
      game,
      homeSide,
      awaySide: homeSide === 'X' ? 'O' : 'X',
      mapId: orderedPool[(game - 1) % orderedPool.length]!,
    });
  }
  return Object.freeze(games.map((entry) => Object.freeze(entry)));
}

export interface SeriesOutcomeInput {
  readonly pairingId: string;
  readonly state: 'SCHEDULED' | 'RUNNING' | 'FINALIZED' | 'CANCELLED';
  readonly winnerSeed?: number | null;
  readonly loserSeed?: number | null;
}

export interface ResolvedPairing {
  readonly id: string;
  readonly round: FinalsRound;
  readonly homeSeed: number | null;
  readonly awaySeed: number | null;
  readonly winnerSeed: number | null;
  readonly state: 'PENDING' | 'FINALIZED';
}

function slotSeed(slot: PairingSlot, resolved: ReadonlyMap<string, ResolvedPairing>): number | null {
  if (slot.kind === 'SEED') return slot.seed;
  const feeder = resolved.get(slot.pairingId);
  if (feeder === undefined || feeder.state !== 'FINALIZED') return null;
  if (slot.kind === 'WINNER') return feeder.winnerSeed;
  return feeder.homeSeed === feeder.winnerSeed ? feeder.awaySeed : feeder.homeSeed;
}

/**
 * Resolves the bracket round by round. A pairing only advances once its feeding series is
 * `FINALIZED` (requirement 12: "Bracket chỉ tiến khi series trước đã `FINALIZED`"); an outcome that
 * reports a winner while still running is refused instead of silently advancing the bracket.
 */
export function resolveBracket(
  bracket: FinalsBracket,
  outcomes: readonly SeriesOutcomeInput[],
): readonly ResolvedPairing[] {
  const outcomeByPairing = new Map<string, SeriesOutcomeInput>();
  for (const outcome of outcomes) {
    if (!bracket.pairings.some(({ id }) => id === outcome.pairingId)) throw new Error('FINALS_PAIRING_UNKNOWN');
    if (outcomeByPairing.has(outcome.pairingId)) throw new Error('FINALS_PAIRING_DUPLICATE');
    outcomeByPairing.set(outcome.pairingId, outcome);
  }

  const resolved = new Map<string, ResolvedPairing>();
  const order: readonly FinalsRound[] = ['QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'BRONZE'];
  for (const round of order) {
    for (const pairing of bracket.pairings.filter((entry) => entry.round === round)) {
      const homeSeed = slotSeed(pairing.home, resolved);
      const awaySeed = slotSeed(pairing.away, resolved);
      const outcome = outcomeByPairing.get(pairing.id);
      let winnerSeed: number | null = null;
      let state: 'PENDING' | 'FINALIZED' = 'PENDING';

      if (outcome !== undefined) {
        const reported = outcome.winnerSeed ?? null;
        if (outcome.state === 'FINALIZED') {
          if (reported === null || (reported !== homeSeed && reported !== awaySeed)) {
            throw new Error('FINALS_WINNER_INVALID');
          }
          winnerSeed = reported;
          state = 'FINALIZED';
        } else if (reported !== null) {
          throw new Error('FINALS_SERIES_NOT_FINALIZED');
        }
      }

      resolved.set(pairing.id, Object.freeze({
        id: pairing.id,
        round: pairing.round,
        homeSeed,
        awaySeed,
        winnerSeed,
        state,
      }));
    }
  }
  return Object.freeze([...resolved.values()]);
}

export interface FinalsOverrideAudit {
  readonly reason: string;
  readonly actor: string;
  readonly at: string;
  readonly evidenceRef: string;
}

export interface SeriesOverrideInput {
  readonly pairingId: string;
  readonly winnerSeed: number;
  readonly loserSeed: number;
  readonly audit: FinalsOverrideAudit;
}

/**
 * Referee override. Requirement 12 requires reason, actor, time and an evidence link for every
 * override, so an incomplete audit is refused instead of being stored as a silent result change.
 */
export function applySeriesOverride(input: SeriesOverrideInput): SeriesOverrideInput {
  const { audit } = input;
  const complete = [input.pairingId, audit.reason, audit.actor, audit.at, audit.evidenceRef].every(
    (field) => typeof field === 'string' && field.trim().length > 0,
  );
  if (!complete) throw new Error('FINALS_OVERRIDE_AUDIT_REQUIRED');
  if (!Number.isSafeInteger(input.winnerSeed) || !Number.isSafeInteger(input.loserSeed)) {
    throw new Error('FINALS_WINNER_INVALID');
  }
  if (input.winnerSeed === input.loserSeed) throw new Error('FINALS_WINNER_INVALID');
  return Object.freeze({
    pairingId: input.pairingId,
    winnerSeed: input.winnerSeed,
    loserSeed: input.loserSeed,
    audit: Object.freeze({ ...audit }),
  });
}
