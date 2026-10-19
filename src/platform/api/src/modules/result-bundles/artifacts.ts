import { canonicalizeJson, sha256HexOf } from './canonical.ts';
import {
  FINALS_BEST_OF,
  createFinalsBracket,
  resolveBracket,
  type FinalsBracket,
  type FinalsGamePlan,
  type FinalsPairing,
  type FinalsRound,
  type FinalsSide,
  type PairingSlot,
  type SeriesOutcomeInput,
} from '../finals/scheduling.ts';
import {
  decideFinalsGame,
  scoreFinalsSeries,
  type FinalsCriterionDirection,
  type FinalsDecisionBasis,
  type FinalsGameAdapterResult,
  type FinalsGameDecision,
} from '../finals/scoring.ts';
import type { LockedSeeding } from '../finals/seeding.ts';

/**
 * P3-D28 finals ResultBundle artifact schemas v1 (PROPOSED, see finals-result-bundle-v1.md).
 *
 * Pure module: strict parsers, the cross-artifact validator that produces the public read model, and
 * the deterministic builder the offline exporter feeds into `exporter.ts`. The validator recomputes
 * every game decision, series outcome and bracket resolution with the L06 domain functions, so a
 * consumer (the future public read endpoint) never has to trust or compute a winner itself.
 */

export const FINALS_ARTIFACT_MEDIA_TYPE = 'application/json';
export const FINALS_REPLAY_MEDIA_TYPE = 'application/vnd.ott.spectator-replay+json;version=1';
export const MAX_FINALS_ARTIFACT_BYTES = 256 * 1024;
export const MAX_FINALS_REPLAY_BYTES = 2 * 1024 * 1024;

export type FinalsArtifactErrorCode =
  | 'ARTIFACT_PATH_UNSUPPORTED'
  | 'ARTIFACT_PATH_DUPLICATE'
  | 'ARTIFACT_MEDIATYPE_INVALID'
  | 'ARTIFACT_TOO_LARGE'
  | 'ARTIFACT_JSON_INVALID'
  | 'ARTIFACT_SCHEMA_INVALID'
  | 'ARTIFACT_VERSION_UNSUPPORTED'
  | 'ARTIFACT_ID_MISMATCH'
  | 'FORBIDDEN_FIELD'
  | 'BRACKET_MISSING'
  | 'BRACKET_DUPLICATE'
  | 'BRACKET_STRUCTURE_MISMATCH'
  | 'SERIES_ORPHAN'
  | 'SERIES_MISSING'
  | 'GAMES_INVALID'
  | 'MATCH_ORPHAN'
  | 'MATCH_MISSING'
  | 'MATCH_INVALID'
  | 'REPLAY_REF_INVALID'
  | 'REPLAY_ORPHAN'
  | 'ADAPTER_INCONSISTENT'
  | 'OUTCOME_MISMATCH';

export interface FinalsArtifactError {
  readonly path: string;
  readonly code: FinalsArtifactErrorCode;
}

class ArtifactParseError extends Error {
  readonly code: 'ARTIFACT_SCHEMA_INVALID' | 'ARTIFACT_VERSION_UNSUPPORTED';

  constructor(code: 'ARTIFACT_SCHEMA_INVALID' | 'ARTIFACT_VERSION_UNSUPPORTED') {
    super(code);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------------------------
// Artifact types
// ---------------------------------------------------------------------------------------------

export interface BracketSeedEntry {
  readonly seed: number;
  readonly teamName: string;
  readonly qualificationRank: number;
  readonly rating: number;
}

export interface ResolvedPairingEntry {
  readonly id: string;
  readonly round: FinalsRound;
  readonly state: 'PENDING' | 'FINALIZED';
  readonly homeSeed: number | null;
  readonly awaySeed: number | null;
  readonly winnerSeed: number | null;
  readonly loserSeed: number | null;
}

export interface BracketArtifact {
  readonly schema: 'ott.finals.bracket';
  readonly schemaVersion: 1;
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly bronzeMatchEnabled: boolean;
  readonly seedingHash: string;
  /** SHA-256 of the committed draw seed; the seed itself is never published. */
  readonly drawSeedCommitment: string;
  readonly seeds: readonly BracketSeedEntry[];
  readonly pairings: readonly FinalsPairing[];
  readonly resolved: readonly ResolvedPairingEntry[];
}

export type SeriesGameState = 'SCHEDULED' | 'FINALIZED' | 'CANCELLED';

export interface SeriesGameEntry {
  readonly game: number;
  readonly homeSide: FinalsSide;
  readonly awaySide: FinalsSide;
  readonly mapId: string;
  readonly matchId: string | null;
  readonly state: SeriesGameState;
}

export interface SeriesOutcomeEntry {
  readonly winnerSeed: number | null;
  readonly loserSeed: number | null;
  readonly homeGameWins: number;
  readonly awayGameWins: number;
  /** Basis of the game that clinched the series; `null` while the series is pending. */
  readonly decisionBasis: FinalsDecisionBasis | null;
}

export interface SeriesArtifact {
  readonly schema: 'ott.finals.series';
  readonly schemaVersion: 1;
  readonly pairingId: string;
  readonly round: FinalsRound;
  readonly bestOf: 3;
  readonly state: 'PENDING' | 'FINALIZED';
  readonly games: readonly SeriesGameEntry[];
  readonly outcome: SeriesOutcomeEntry;
}

export interface MatchFaultEntry {
  readonly recoverableTotal: number;
  readonly lastErrorCode: string | null;
}

export interface MatchCriterionEntry {
  readonly id: string;
  readonly direction: FinalsCriterionDirection;
  readonly x: number;
  readonly o: number;
}

export interface MatchArtifact {
  readonly schema: 'ott.finals.match';
  readonly schemaVersion: 1;
  readonly matchId: string;
  readonly pairingId: string;
  readonly game: number;
  readonly sides: { readonly X: number; readonly O: number };
  readonly result: {
    readonly winnerSide: FinalsSide | null;
    readonly reason: string;
    readonly turnCount: number;
    readonly finalStateHash: string;
  };
  readonly adapter: {
    readonly adapterId: string;
    readonly adapterVersion: string;
    /** Side the adapter named directly, `null` when the ordered criteria decide. */
    readonly directWinnerSide: FinalsSide | null;
    readonly criteria: readonly MatchCriterionEntry[];
  };
  readonly faultSummary: { readonly X: MatchFaultEntry; readonly O: MatchFaultEntry };
  readonly eventLogSha256: string;
  readonly replay: { readonly path: string | null; readonly sha256: string | null };
}

export interface ReplayArtifactEnvelope {
  readonly schema: 'ott.spectator-replay';
  readonly schemaVersion: 1;
  readonly matchId: string;
}

export interface FinalsBundlePairingView extends ResolvedPairingEntry {
  readonly slot: number;
  readonly home: PairingSlot;
  readonly away: PairingSlot;
  readonly series: SeriesArtifact | null;
}

/** Read model for the public finals endpoint: everything in it was recomputed and cross-checked. */
export interface FinalsBundleView {
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly bronzeMatchEnabled: boolean;
  readonly seedingHash: string;
  readonly drawSeedCommitment: string;
  readonly seeds: readonly BracketSeedEntry[];
  readonly pairings: readonly FinalsBundlePairingView[];
  readonly matches: readonly MatchArtifact[];
  /** Match ids whose public replay payload is part of the bundle. */
  readonly replayMatchIds: readonly string[];
}

// ---------------------------------------------------------------------------------------------
// Strict parsing helpers
// ---------------------------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const ROUNDS: readonly FinalsRound[] = ['QUARTERFINAL', 'SEMIFINAL', 'FINAL', 'BRONZE'];
const SIDES: readonly FinalsSide[] = ['X', 'O'];
const BASES: readonly FinalsDecisionBasis[] = ['DIRECT', 'CRITERION', 'QUALIFICATION_SEED'];

function invalid(): never {
  throw new ArtifactParseError('ARTIFACT_SCHEMA_INVALID');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Exactly these keys, no more and no fewer (`additionalProperties: false`). */
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) return invalid();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.hasOwn(value, key))) return invalid();
  return value;
}

function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > max) return invalid();
  return value;
}

function pattern(value: unknown, expression: RegExp): string {
  if (typeof value !== 'string' || !expression.test(value)) return invalid();
  return value;
}

function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}

function finite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) return invalid();
  return value;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) return invalid();
  return value as T;
}

function nullable<T>(value: unknown, read: (entry: unknown) => T): T | null {
  return value === null ? null : read(value);
}

function list(value: unknown, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length > max) return invalid();
  return value;
}

function header(value: unknown, schema: string): Record<string, unknown> {
  if (!isRecord(value) || value['schema'] !== schema) return invalid();
  if (value['schemaVersion'] !== 1) {
    if (Number.isSafeInteger(value['schemaVersion'])) throw new ArtifactParseError('ARTIFACT_VERSION_UNSUPPORTED');
    return invalid();
  }
  return value;
}

function parseSlot(value: unknown): PairingSlot {
  if (!isRecord(value)) return invalid();
  if (value['kind'] === 'SEED') {
    const slot = record(value, ['kind', 'seed']);
    return { kind: 'SEED', seed: integer(slot['seed'], 1, 8) };
  }
  const kind = oneOf(value['kind'], ['WINNER', 'LOSER'] as const);
  const slot = record(value, ['kind', 'pairingId']);
  return { kind, pairingId: pattern(slot['pairingId'], ID_PATTERN) };
}

const bracketKeys = [
  'schema', 'schemaVersion', 'tournamentId', 'finalsRuleSetId', 'bronzeMatchEnabled', 'seedingHash',
  'drawSeedCommitment', 'seeds', 'pairings', 'resolved',
] as const;

export function parseBracketArtifact(value: unknown): BracketArtifact {
  const head = header(value, 'ott.finals.bracket');
  const raw = record(head, bracketKeys);
  if (typeof raw['bronzeMatchEnabled'] !== 'boolean') return invalid();
  return {
    schema: 'ott.finals.bracket',
    schemaVersion: 1,
    tournamentId: text(raw['tournamentId']),
    finalsRuleSetId: text(raw['finalsRuleSetId']),
    bronzeMatchEnabled: raw['bronzeMatchEnabled'],
    seedingHash: pattern(raw['seedingHash'], HEX64),
    drawSeedCommitment: pattern(raw['drawSeedCommitment'], HEX64),
    seeds: list(raw['seeds'], 16).map((entry) => {
      const seed = record(entry, ['seed', 'teamName', 'qualificationRank', 'rating']);
      return {
        seed: integer(seed['seed'], 1, 64),
        teamName: text(seed['teamName']),
        qualificationRank: integer(seed['qualificationRank'], 1, 64),
        rating: finite(seed['rating']),
      };
    }),
    pairings: list(raw['pairings'], 16).map((entry) => {
      const pairing = record(entry, ['id', 'round', 'slot', 'home', 'away']);
      return {
        id: pattern(pairing['id'], ID_PATTERN),
        round: oneOf(pairing['round'], ROUNDS),
        slot: integer(pairing['slot'], 1, 16),
        home: parseSlot(pairing['home']),
        away: parseSlot(pairing['away']),
      };
    }),
    resolved: list(raw['resolved'], 16).map((entry) => {
      const row = record(entry, ['id', 'round', 'state', 'homeSeed', 'awaySeed', 'winnerSeed', 'loserSeed']);
      const seed = (field: unknown) => nullable(field, (v) => integer(v, 1, 64));
      return {
        id: pattern(row['id'], ID_PATTERN),
        round: oneOf(row['round'], ROUNDS),
        state: oneOf(row['state'], ['PENDING', 'FINALIZED'] as const),
        homeSeed: seed(row['homeSeed']),
        awaySeed: seed(row['awaySeed']),
        winnerSeed: seed(row['winnerSeed']),
        loserSeed: seed(row['loserSeed']),
      };
    }),
  };
}

export function parseSeriesArtifact(value: unknown): SeriesArtifact {
  const raw = record(header(value, 'ott.finals.series'), [
    'schema', 'schemaVersion', 'pairingId', 'round', 'bestOf', 'state', 'games', 'outcome',
  ]);
  if (raw['bestOf'] !== FINALS_BEST_OF) return invalid();
  const outcome = record(raw['outcome'], ['winnerSeed', 'loserSeed', 'homeGameWins', 'awayGameWins', 'decisionBasis']);
  return {
    schema: 'ott.finals.series',
    schemaVersion: 1,
    pairingId: pattern(raw['pairingId'], ID_PATTERN),
    round: oneOf(raw['round'], ROUNDS),
    bestOf: 3,
    state: oneOf(raw['state'], ['PENDING', 'FINALIZED'] as const),
    games: list(raw['games'], FINALS_BEST_OF).map((entry) => {
      const game = record(entry, ['game', 'homeSide', 'awaySide', 'mapId', 'matchId', 'state']);
      return {
        game: integer(game['game'], 1, FINALS_BEST_OF),
        homeSide: oneOf(game['homeSide'], SIDES),
        awaySide: oneOf(game['awaySide'], SIDES),
        mapId: text(game['mapId']),
        matchId: nullable(game['matchId'], (v) => pattern(v, ID_PATTERN)),
        state: oneOf(game['state'], ['SCHEDULED', 'FINALIZED', 'CANCELLED'] as const),
      };
    }),
    outcome: {
      winnerSeed: nullable(outcome['winnerSeed'], (v) => integer(v, 1, 64)),
      loserSeed: nullable(outcome['loserSeed'], (v) => integer(v, 1, 64)),
      homeGameWins: integer(outcome['homeGameWins'], 0, FINALS_BEST_OF),
      awayGameWins: integer(outcome['awayGameWins'], 0, FINALS_BEST_OF),
      decisionBasis: nullable(outcome['decisionBasis'], (v) => oneOf(v, BASES)),
    },
  };
}

function parseFault(value: unknown): MatchFaultEntry {
  const fault = record(value, ['recoverableTotal', 'lastErrorCode']);
  return {
    recoverableTotal: integer(fault['recoverableTotal'], 0, 1_000_000),
    lastErrorCode: nullable(fault['lastErrorCode'], (v) => pattern(v, CODE_PATTERN)),
  };
}

export function parseMatchArtifact(value: unknown): MatchArtifact {
  const raw = record(header(value, 'ott.finals.match'), [
    'schema', 'schemaVersion', 'matchId', 'pairingId', 'game', 'sides', 'result', 'adapter', 'faultSummary',
    'eventLogSha256', 'replay',
  ]);
  const sides = record(raw['sides'], ['X', 'O']);
  const result = record(raw['result'], ['winnerSide', 'reason', 'turnCount', 'finalStateHash']);
  const adapter = record(raw['adapter'], ['adapterId', 'adapterVersion', 'directWinnerSide', 'criteria']);
  const faults = record(raw['faultSummary'], ['X', 'O']);
  const replay = record(raw['replay'], ['path', 'sha256']);
  if ((replay['path'] === null) !== (replay['sha256'] === null)) return invalid();
  return {
    schema: 'ott.finals.match',
    schemaVersion: 1,
    matchId: pattern(raw['matchId'], ID_PATTERN),
    pairingId: pattern(raw['pairingId'], ID_PATTERN),
    game: integer(raw['game'], 1, FINALS_BEST_OF),
    sides: { X: integer(sides['X'], 1, 64), O: integer(sides['O'], 1, 64) },
    result: {
      winnerSide: nullable(result['winnerSide'], (v) => oneOf(v, SIDES)),
      reason: pattern(result['reason'], CODE_PATTERN),
      turnCount: integer(result['turnCount'], 0, 1_000_000),
      finalStateHash: pattern(result['finalStateHash'], /^[A-Za-z0-9:_-]{1,128}$/),
    },
    adapter: {
      adapterId: text(adapter['adapterId']),
      adapterVersion: text(adapter['adapterVersion']),
      directWinnerSide: nullable(adapter['directWinnerSide'], (v) => oneOf(v, SIDES)),
      criteria: list(adapter['criteria'], 32).map((entry) => {
        const criterion = record(entry, ['id', 'direction', 'x', 'o']);
        return {
          id: text(criterion['id']),
          direction: oneOf(criterion['direction'], ['HIGHER_WINS', 'LOWER_WINS'] as const),
          x: finite(criterion['x']),
          o: finite(criterion['o']),
        };
      }),
    },
    faultSummary: { X: parseFault(faults['X']), O: parseFault(faults['O']) },
    eventLogSha256: pattern(raw['eventLogSha256'], HEX64),
    replay: {
      path: nullable(replay['path'], (v) => pattern(v, /^replays\/[A-Za-z0-9_-]{1,64}\.json$/)),
      sha256: nullable(replay['sha256'], (v) => pattern(v, HEX64)),
    },
  };
}

/**
 * Envelope check only: the replay body is the public spectator payload and its own validator stays
 * with the replay module / web parser, so nothing beyond identity is duplicated here.
 */
export function parseReplayArtifactEnvelope(value: unknown): ReplayArtifactEnvelope {
  const raw = header(value, 'ott.spectator-replay');
  return {
    schema: 'ott.spectator-replay',
    schemaVersion: 1,
    matchId: pattern(raw['matchId'], ID_PATTERN),
  };
}

// ---------------------------------------------------------------------------------------------
// Privacy scan
// ---------------------------------------------------------------------------------------------

const FORBIDDEN_KEY = /seed$|^seed|password|secret|credential|stderr|object_?key|token/i;

/** Public key names that legitimately match the forbidden pattern, at any depth. */
const PUBLIC_KEY_NAMES: ReadonlySet<string> = new Set([
  'seeds', 'homeSeed', 'awaySeed', 'winnerSeed', 'loserSeed', 'qualificationRank', 'seedingHash',
]);
/** The bare `seed` ordinal is public only where the schema defines it. */
const PUBLIC_KEY_PATHS: ReadonlySet<string> = new Set([
  'seeds.[].seed', 'pairings.[].home.seed', 'pairings.[].away.seed',
]);

/** Returns the dotted path of the first forbidden key, or `null` when the artifact is clean. */
export function findForbiddenKey(value: unknown, path: readonly string[] = []): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findForbiddenKey(entry, [...path, '[]']);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, entry] of Object.entries(value)) {
    const keyPath = [...path, key];
    if (FORBIDDEN_KEY.test(key) && !PUBLIC_KEY_NAMES.has(key) && !PUBLIC_KEY_PATHS.has(keyPath.join('.'))) {
      return keyPath.join('.');
    }
    const found = findForbiddenKey(entry, keyPath);
    if (found !== null) return found;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Outcome evaluation shared by the validator and the builder
// ---------------------------------------------------------------------------------------------

export interface GameFact {
  readonly state: SeriesGameState;
  /** Present when `state === 'FINALIZED'`, expressed in home/away terms. */
  readonly adapter?: {
    readonly adapterId: string;
    readonly adapterVersion: string;
    readonly result: FinalsGameAdapterResult;
  };
}

export interface PairingEvaluation {
  readonly homeSeed: number;
  readonly awaySeed: number;
  readonly decisions: readonly (FinalsGameDecision | null)[];
  readonly state: 'PENDING' | 'FINALIZED';
  readonly outcome: SeriesOutcomeEntry;
}

export interface BracketEvaluation {
  readonly pairings: ReadonlyMap<string, PairingEvaluation>;
  readonly resolved: readonly ResolvedPairingEntry[];
}

/**
 * Plays the bracket forward with the domain functions: per game `decideFinalsGame`, per series
 * `scoreFinalsSeries`, per round `resolveBracket`. Throws the domain error code when the facts are
 * not coherent (extra game after the clinch, a series before its feeders finished, adapter drift).
 */
export function evaluateFinalsBracket(
  bracket: FinalsBracket,
  facts: ReadonlyMap<string, readonly GameFact[]>,
): BracketEvaluation {
  const outcomes: SeriesOutcomeInput[] = [];
  const evaluations = new Map<string, PairingEvaluation>();
  let pinned: { adapterId: string; adapterVersion: string } | null = null;

  for (const round of ROUNDS) {
    for (const pairing of bracket.pairings.filter((entry) => entry.round === round)) {
      const games = facts.get(pairing.id);
      if (games === undefined) continue;
      const row = resolveBracket(bracket, outcomes).find(({ id }) => id === pairing.id)!;
      if (row.homeSeed === null || row.awaySeed === null) throw new Error('FINALS_SERIES_NOT_FINALIZED');
      const { homeSeed, awaySeed } = row;

      const decisions: (FinalsGameDecision | null)[] = games.map((fact) => {
        if (fact.state !== 'FINALIZED') return null;
        if (fact.adapter === undefined) throw new Error('FINALS_CRITERION_INVALID');
        pinned ??= { adapterId: fact.adapter.adapterId, adapterVersion: fact.adapter.adapterVersion };
        return decideFinalsGame(fact.adapter.result, {
          adapterId: fact.adapter.adapterId,
          adapterVersion: fact.adapter.adapterVersion,
          pinnedAdapterId: pinned.adapterId,
          pinnedAdapterVersion: pinned.adapterVersion,
          homeSeed,
          awaySeed,
        });
      });
      const played = decisions.filter((entry): entry is FinalsGameDecision => entry !== null);
      const winners = played.map(({ winner }) => winner);
      const score = scoreFinalsSeries(winners);
      if (winners.length > 0 && scoreFinalsSeries(winners.slice(0, -1)).state === 'FINALIZED') {
        throw new Error('FINALS_SERIES_EXTRA_GAME');
      }

      const winnerSeed = score.winner === null ? null : score.winner === 'HOME' ? homeSeed : awaySeed;
      const loserSeed = score.winner === null ? null : score.winner === 'HOME' ? awaySeed : homeSeed;
      outcomes.push({
        pairingId: pairing.id,
        state: score.state === 'FINALIZED' ? 'FINALIZED' : 'SCHEDULED',
        winnerSeed,
        loserSeed,
      });
      evaluations.set(pairing.id, {
        homeSeed,
        awaySeed,
        decisions,
        state: score.state,
        outcome: {
          winnerSeed,
          loserSeed,
          homeGameWins: score.homeGames,
          awayGameWins: score.awayGames,
          decisionBasis: score.state === 'FINALIZED' ? played[played.length - 1]!.basis : null,
        },
      });
    }
  }

  const resolved = resolveBracket(bracket, outcomes).map((row): ResolvedPairingEntry => ({
    id: row.id,
    round: row.round,
    state: row.state,
    homeSeed: row.homeSeed,
    awaySeed: row.awaySeed,
    winnerSeed: row.winnerSeed,
    loserSeed:
      row.winnerSeed === null ? null : row.winnerSeed === row.homeSeed ? row.awaySeed : row.homeSeed,
  }));
  return { pairings: evaluations, resolved };
}

// ---------------------------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------------------------

export interface FinalsBundleArtifactBytes {
  readonly path: string;
  readonly mediaType: string;
  readonly bytes: Uint8Array;
}

export type ValidateBundleArtifactsResult =
  | { readonly ok: true; readonly value: FinalsBundleView }
  | { readonly ok: false; readonly errors: readonly FinalsArtifactError[] };

type ArtifactKind = 'bracket' | 'series' | 'match' | 'replay';

function classifyPath(path: string): { kind: ArtifactKind; id: string | null } | null {
  if (path === 'bracket.json') return { kind: 'bracket', id: null };
  const matched = /^(series|matches|replays)\/([A-Za-z0-9_-]{1,64})\.json$/.exec(path);
  if (matched === null) return null;
  const kind = matched[1] === 'series' ? 'series' : matched[1] === 'matches' ? 'match' : 'replay';
  return { kind, id: matched[2]! };
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/** Maps the match's side-based adapter output onto the pairing's home/away terms. */
function adapterFact(match: MatchArtifact, homeSide: FinalsSide): NonNullable<GameFact['adapter']> {
  const homeIsX = homeSide === 'X';
  const direct = match.adapter.directWinnerSide;
  return {
    adapterId: match.adapter.adapterId,
    adapterVersion: match.adapter.adapterVersion,
    result: {
      directWinner: direct === null ? null : direct === homeSide ? 'HOME' : 'AWAY',
      scoreBreakdown: match.adapter.criteria.map((criterion) => ({
        criterionId: criterion.id,
        direction: criterion.direction,
        home: homeIsX ? criterion.x : criterion.o,
        away: homeIsX ? criterion.o : criterion.x,
      })),
    },
  };
}

export function validateBundleArtifacts(
  artifacts: readonly FinalsBundleArtifactBytes[],
): ValidateBundleArtifactsResult {
  const errors: FinalsArtifactError[] = [];
  const add = (path: string, code: FinalsArtifactErrorCode) => errors.push({ path, code });

  const seenPaths = new Set<string>();
  const brackets: BracketArtifact[] = [];
  const series = new Map<string, SeriesArtifact>();
  const matches = new Map<string, MatchArtifact>();
  const replays = new Map<string, { envelope: ReplayArtifactEnvelope; sha256: string }>();
  let bracketCount = 0;

  for (const artifact of artifacts) {
    const { path } = artifact;
    const kind = classifyPath(path);
    if (kind === null) {
      add(path, 'ARTIFACT_PATH_UNSUPPORTED');
      continue;
    }
    if (seenPaths.has(path)) {
      add(path, 'ARTIFACT_PATH_DUPLICATE');
      continue;
    }
    seenPaths.add(path);
    if (kind.kind === 'bracket') bracketCount += 1;

    const isReplay = kind.kind === 'replay';
    if (artifact.mediaType !== (isReplay ? FINALS_REPLAY_MEDIA_TYPE : FINALS_ARTIFACT_MEDIA_TYPE)) {
      add(path, 'ARTIFACT_MEDIATYPE_INVALID');
      continue;
    }
    if (artifact.bytes.byteLength > (isReplay ? MAX_FINALS_REPLAY_BYTES : MAX_FINALS_ARTIFACT_BYTES)) {
      add(path, 'ARTIFACT_TOO_LARGE');
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(artifact.bytes));
    } catch {
      add(path, 'ARTIFACT_JSON_INVALID');
      continue;
    }
    if (findForbiddenKey(json) !== null) {
      add(path, 'FORBIDDEN_FIELD');
      continue;
    }

    try {
      switch (kind.kind) {
        case 'bracket':
          brackets.push(parseBracketArtifact(json));
          break;
        case 'series': {
          const parsed = parseSeriesArtifact(json);
          if (parsed.pairingId !== kind.id) add(path, 'ARTIFACT_ID_MISMATCH');
          else series.set(parsed.pairingId, parsed);
          break;
        }
        case 'match': {
          const parsed = parseMatchArtifact(json);
          if (parsed.matchId !== kind.id) add(path, 'ARTIFACT_ID_MISMATCH');
          else matches.set(parsed.matchId, parsed);
          break;
        }
        case 'replay': {
          const envelope = parseReplayArtifactEnvelope(json);
          if (envelope.matchId !== kind.id) add(path, 'REPLAY_REF_INVALID');
          else replays.set(envelope.matchId, { envelope, sha256: sha256HexOf(artifact.bytes) });
          break;
        }
      }
    } catch (error) {
      if (!(error instanceof ArtifactParseError)) throw error;
      add(path, error.code);
    }
  }

  if (bracketCount === 0) add('bracket.json', 'BRACKET_MISSING');
  if (bracketCount > 1) add('bracket.json', 'BRACKET_DUPLICATE');
  if (errors.length > 0) return { ok: false, errors };

  const bracketArtifact = brackets[0]!;
  const crossErrors = crossCheck(bracketArtifact, series, matches, replays);
  if (crossErrors.length > 0) return { ok: false, errors: crossErrors };

  return {
    ok: true,
    value: {
      tournamentId: bracketArtifact.tournamentId,
      finalsRuleSetId: bracketArtifact.finalsRuleSetId,
      bronzeMatchEnabled: bracketArtifact.bronzeMatchEnabled,
      seedingHash: bracketArtifact.seedingHash,
      drawSeedCommitment: bracketArtifact.drawSeedCommitment,
      seeds: bracketArtifact.seeds,
      pairings: bracketArtifact.pairings.map((pairing, index): FinalsBundlePairingView => ({
        ...bracketArtifact.resolved[index]!,
        slot: pairing.slot,
        home: pairing.home,
        away: pairing.away,
        series: series.get(pairing.id) ?? null,
      })),
      matches: [...matches.values()].sort((a, b) => (a.matchId < b.matchId ? -1 : a.matchId > b.matchId ? 1 : 0)),
      replayMatchIds: [...replays.keys()].sort(),
    },
  };
}

function crossCheck(
  bracketArtifact: BracketArtifact,
  series: ReadonlyMap<string, SeriesArtifact>,
  matches: ReadonlyMap<string, MatchArtifact>,
  replays: ReadonlyMap<string, { envelope: ReplayArtifactEnvelope; sha256: string }>,
): FinalsArtifactError[] {
  const errors: FinalsArtifactError[] = [];
  const add = (path: string, code: FinalsArtifactErrorCode) => errors.push({ path, code });

  // Bracket structure: 8 ordered seeds and exactly the pairings the domain builds for them.
  const seedsOk =
    bracketArtifact.seeds.length === 8 &&
    bracketArtifact.seeds.every((entry, index) => entry.seed === index + 1 && entry.qualificationRank === index + 1);
  if (!seedsOk) {
    add('bracket.json', 'BRACKET_STRUCTURE_MISMATCH');
    return errors;
  }
  const expected = createFinalsBracket(
    {
      seeds: bracketArtifact.seeds.map(({ seed }) => ({ ordinal: seed, teamId: '-', submissionId: '-' })),
      drawSeed: '-',
      minimumSeries: 0,
      seedingHash: bracketArtifact.seedingHash,
    } satisfies LockedSeeding,
    { bronzeMatchEnabled: bracketArtifact.bronzeMatchEnabled },
  );
  const resolvedShape = bracketArtifact.resolved.map(({ id, round }) => ({ id, round }));
  if (
    !sameJson(bracketArtifact.pairings, expected.pairings) ||
    !sameJson(resolvedShape, expected.pairings.map(({ id, round }) => ({ id, round })))
  ) {
    add('bracket.json', 'BRACKET_STRUCTURE_MISMATCH');
    return errors;
  }

  // Series <-> bracket.
  const pairingById = new Map(expected.pairings.map((pairing) => [pairing.id, pairing]));
  for (const [pairingId, entry] of series) {
    if (pairingById.get(pairingId)?.round !== entry.round) add(`series/${pairingId}.json`, 'SERIES_ORPHAN');
  }
  for (const row of bracketArtifact.resolved) {
    if (row.state === 'FINALIZED' && !series.has(row.id)) add(`series/${row.id}.json`, 'SERIES_MISSING');
  }

  // Game lists, then matches.
  const gameByMatch = new Map<string, { pairingId: string; game: number; homeSide: FinalsSide }>();
  for (const [pairingId, entry] of series) {
    const path = `series/${pairingId}.json`;
    const mapIds = new Set(entry.games.map(({ mapId }) => mapId));
    const gamesOk =
      entry.games.every((game, index) => game.game === index + 1 && game.awaySide !== game.homeSide) &&
      (entry.games.length < 1 || entry.games[0]!.homeSide === 'X') &&
      (entry.games.length < 2 || entry.games[1]!.homeSide === 'O') &&
      mapIds.size === entry.games.length &&
      entry.games.every((game) => (game.state === 'FINALIZED') === (game.matchId !== null));
    if (!gamesOk) {
      add(path, 'GAMES_INVALID');
      continue;
    }
    for (const game of entry.games) {
      if (game.matchId === null) continue;
      if (gameByMatch.has(game.matchId)) add(path, 'GAMES_INVALID');
      gameByMatch.set(game.matchId, { pairingId, game: game.game, homeSide: game.homeSide });
      if (!matches.has(game.matchId)) add(`matches/${game.matchId}.json`, 'MATCH_MISSING');
    }
  }
  for (const [matchId, match] of matches) {
    const owner = gameByMatch.get(matchId);
    if (owner === undefined || owner.pairingId !== match.pairingId || owner.game !== match.game) {
      add(`matches/${matchId}.json`, 'MATCH_ORPHAN');
    }
  }

  // Replay references.
  const referenced = new Set<string>();
  for (const [matchId, match] of matches) {
    if (match.replay.path === null) continue;
    const replay = replays.get(matchId);
    if (
      match.replay.path !== `replays/${matchId}.json` ||
      replay === undefined ||
      replay.envelope.matchId !== matchId ||
      replay.sha256 !== match.replay.sha256
    ) {
      add(`matches/${matchId}.json`, 'REPLAY_REF_INVALID');
    } else {
      referenced.add(matchId);
    }
  }
  for (const matchId of replays.keys()) {
    if (!referenced.has(matchId) && !errors.some((error) => error.path === `matches/${matchId}.json`)) {
      add(`replays/${matchId}.json`, 'REPLAY_ORPHAN');
    }
  }
  if (errors.length > 0) return errors;

  // Recompute every decision, series outcome and bracket row from the match facts.
  const facts = new Map<string, GameFact[]>();
  const seriesErrors: FinalsArtifactError[] = [];
  for (const [pairingId, entry] of series) {
    facts.set(
      pairingId,
      entry.games.map((game): GameFact => {
        if (game.matchId === null) return { state: game.state };
        return { state: 'FINALIZED', adapter: adapterFact(matches.get(game.matchId)!, game.homeSide) };
      }),
    );
  }
  let evaluation: BracketEvaluation;
  try {
    evaluation = evaluateFinalsBracket(expected, facts);
  } catch (error) {
    const code = error instanceof Error && error.message === 'FINALS_ADAPTER_VERSION_MISMATCH'
      ? 'ADAPTER_INCONSISTENT'
      : 'OUTCOME_MISMATCH';
    add('bracket.json', code);
    return errors;
  }

  for (const [pairingId, entry] of series) {
    const computed = evaluation.pairings.get(pairingId)!;
    const path = `series/${pairingId}.json`;
    if (entry.state !== computed.state || !sameJson(entry.outcome, computed.outcome)) {
      seriesErrors.push({ path, code: 'OUTCOME_MISMATCH' });
    }
    entry.games.forEach((game, index) => {
      if (game.matchId === null) return;
      const match = matches.get(game.matchId)!;
      const decision = computed.decisions[index]!;
      const homeIsX = game.homeSide === 'X';
      const homeSeed = homeIsX ? match.sides.X : match.sides.O;
      const awaySeed = homeIsX ? match.sides.O : match.sides.X;
      if (homeSeed !== computed.homeSeed || awaySeed !== computed.awaySeed) {
        seriesErrors.push({ path: `matches/${game.matchId}.json`, code: 'MATCH_INVALID' });
        return;
      }
      const winnerSide = decision.winner === 'HOME' ? game.homeSide : game.awaySide;
      if (match.result.winnerSide !== winnerSide) {
        seriesErrors.push({ path: `matches/${game.matchId}.json`, code: 'OUTCOME_MISMATCH' });
      }
    });
  }
  if (!sameJson(bracketArtifact.resolved, evaluation.resolved)) {
    seriesErrors.push({ path: 'bracket.json', code: 'OUTCOME_MISMATCH' });
  }
  return seriesErrors;
}

// ---------------------------------------------------------------------------------------------
// Deterministic builder
// ---------------------------------------------------------------------------------------------

export interface FinalsBundleFinalizedGameInput {
  readonly matchId: string;
  readonly adapterId: string;
  readonly adapterVersion: string;
  /** Domain adapter output in home/away terms; the builder converts it to X/O. */
  readonly adapterResult: FinalsGameAdapterResult;
  readonly reason: string;
  readonly turnCount: number;
  readonly finalStateHash: string;
  readonly faults: { readonly X: MatchFaultEntry; readonly O: MatchFaultEntry };
  readonly eventLogSha256: string;
  /** Public spectator replay payload (already sanitized); embedded as canonical JSON. */
  readonly replay?: Record<string, unknown>;
}

export interface FinalsBundleGameInput {
  readonly plan: FinalsGamePlan;
  readonly state: SeriesGameState;
  readonly finalized?: FinalsBundleFinalizedGameInput;
}

export interface FinalsBundleBuildInput {
  readonly tournamentId: string;
  readonly finalsRuleSetId: string;
  readonly seeding: LockedSeeding;
  readonly bracket: FinalsBracket;
  readonly teams: readonly { readonly seed: number; readonly teamName: string; readonly rating: number }[];
  readonly series: readonly { readonly pairingId: string; readonly games: readonly FinalsBundleGameInput[] }[];
}

export interface BuiltFinalsArtifact {
  readonly path: string;
  readonly mediaType: string;
  readonly payload: Buffer;
}

function jsonBuffer(value: unknown): Buffer {
  return Buffer.from(canonicalizeJson(value), 'utf8');
}

/**
 * Builds the artifact set in a fixed order (bracket, series, matches, replays — each in bracket
 * order) with canonical JSON, so the same input always yields the same bytes. Outcomes are derived
 * with `evaluateFinalsBracket`; the caller supplies facts, never winners.
 */
export function buildFinalsBundleArtifacts(input: FinalsBundleBuildInput): BuiltFinalsArtifact[] {
  const pairingOrder = input.bracket.pairings;
  const seriesById = new Map(input.series.map((entry) => [entry.pairingId, entry]));
  const facts = new Map<string, GameFact[]>();
  for (const entry of input.series) {
    facts.set(
      entry.pairingId,
      entry.games.map((game): GameFact => {
        if (game.state !== 'FINALIZED') return { state: game.state };
        if (game.finalized === undefined) throw new Error('FINALS_BUNDLE_GAME_INCOMPLETE');
        return {
          state: 'FINALIZED',
          adapter: {
            adapterId: game.finalized.adapterId,
            adapterVersion: game.finalized.adapterVersion,
            result: game.finalized.adapterResult,
          },
        };
      }),
    );
  }
  const evaluation = evaluateFinalsBracket(input.bracket, facts);

  const bracket: BracketArtifact = {
    schema: 'ott.finals.bracket',
    schemaVersion: 1,
    tournamentId: input.tournamentId,
    finalsRuleSetId: input.finalsRuleSetId,
    bronzeMatchEnabled: input.bracket.bronzeMatchEnabled,
    seedingHash: input.seeding.seedingHash,
    drawSeedCommitment: sha256HexOf(input.seeding.drawSeed),
    seeds: [...input.teams]
      .sort((a, b) => a.seed - b.seed)
      .map(({ seed, teamName, rating }) => ({ seed, teamName, qualificationRank: seed, rating })),
    pairings: pairingOrder.map(({ id, round, slot, home, away }) => ({ id, round, slot, home, away })),
    resolved: evaluation.resolved,
  };
  const out: BuiltFinalsArtifact[] = [
    { path: 'bracket.json', mediaType: FINALS_ARTIFACT_MEDIA_TYPE, payload: jsonBuffer(bracket) },
  ];
  const matchOut: BuiltFinalsArtifact[] = [];
  const replayOut: BuiltFinalsArtifact[] = [];

  for (const pairing of pairingOrder) {
    const entry = seriesById.get(pairing.id);
    const computed = evaluation.pairings.get(pairing.id);
    if (entry === undefined || computed === undefined) continue;
    const seriesArtifact: SeriesArtifact = {
      schema: 'ott.finals.series',
      schemaVersion: 1,
      pairingId: pairing.id,
      round: pairing.round,
      bestOf: 3,
      state: computed.state,
      games: entry.games.map(({ plan, state, finalized }) => ({
        game: plan.game,
        homeSide: plan.homeSide,
        awaySide: plan.awaySide,
        mapId: plan.mapId,
        matchId: finalized?.matchId ?? null,
        state,
      })),
      outcome: computed.outcome,
    };
    out.push({ path: `series/${pairing.id}.json`, mediaType: FINALS_ARTIFACT_MEDIA_TYPE, payload: jsonBuffer(seriesArtifact) });

    entry.games.forEach(({ plan, finalized }, index) => {
      if (finalized === undefined) return;
      const decision = computed.decisions[index]!;
      const homeIsX = plan.homeSide === 'X';
      const seedOf = (side: FinalsSide) => ((side === 'X') === homeIsX ? computed.homeSeed : computed.awaySeed);
      const direct = finalized.adapterResult.directWinner ?? null;
      let replay: MatchArtifact['replay'] = { path: null, sha256: null };
      if (finalized.replay !== undefined) {
        const payload = jsonBuffer(finalized.replay);
        const path = `replays/${finalized.matchId}.json`;
        replay = { path, sha256: sha256HexOf(payload) };
        replayOut.push({ path, mediaType: FINALS_REPLAY_MEDIA_TYPE, payload });
      }
      const match: MatchArtifact = {
        schema: 'ott.finals.match',
        schemaVersion: 1,
        matchId: finalized.matchId,
        pairingId: pairing.id,
        game: plan.game,
        sides: { X: seedOf('X'), O: seedOf('O') },
        result: {
          winnerSide: decision.winner === 'HOME' ? plan.homeSide : plan.awaySide,
          reason: finalized.reason,
          turnCount: finalized.turnCount,
          finalStateHash: finalized.finalStateHash,
        },
        adapter: {
          adapterId: finalized.adapterId,
          adapterVersion: finalized.adapterVersion,
          directWinnerSide: direct === null ? null : direct === 'HOME' ? plan.homeSide : plan.awaySide,
          criteria: (finalized.adapterResult.scoreBreakdown ?? []).map((criterion) => ({
            id: criterion.criterionId,
            direction: criterion.direction,
            x: homeIsX ? criterion.home : criterion.away,
            o: homeIsX ? criterion.away : criterion.home,
          })),
        },
        faultSummary: finalized.faults,
        eventLogSha256: finalized.eventLogSha256,
        replay,
      };
      matchOut.push({
        path: `matches/${finalized.matchId}.json`,
        mediaType: FINALS_ARTIFACT_MEDIA_TYPE,
        payload: jsonBuffer(match),
      });
    });
  }
  return [...out, ...matchOut, ...replayOut];
}
